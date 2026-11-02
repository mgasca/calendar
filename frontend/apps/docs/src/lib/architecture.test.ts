import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Adr, Story } from './adr';
import {
  architecturePages,
  architectureSidebar,
  checkArchitecture,
  escapeCell,
  mermaidText,
  pagePath,
  pageRoute,
  parseArchitecture,
  renderValue,
  shortLabel,
} from './architecture';

const requirement = 'https://example.test/auth.requirement.json';

/** The shape of the test model, loose enough for the mutations below to stay type-safe. */
interface TestModel {
  'unique-id': string;
  name: string;
  description: string;
  metadata: {
    adrs: { id: string; title: string; status: string; file: string; url: string }[];
    stories: { id: string; title: string; status: string; url: string }[];
    views?: Record<string, { title: string; description: string; nodes: string[] }>;
  };
  nodes: {
    'unique-id': string;
    'node-type': string;
    name?: string;
    description: string;
    interfaces?: Record<string, unknown>[];
    controls?: Record<
      string,
      {
        description: string;
        requirements: { 'requirement-url': string; config: Record<string, unknown> }[];
      }
    >;
    metadata?: Record<string, unknown>;
  }[];
  relationships: {
    'unique-id': string;
    description?: string;
    protocol?: string;
    'relationship-type': Record<string, Record<string, unknown>>;
  }[];
  flows: {
    'unique-id': string;
    name: string;
    description: string;
    transitions: {
      'relationship-unique-id': string;
      'sequence-number': number;
      description: string;
      direction?: string;
    }[];
    metadata: Record<string, unknown>;
  }[];
}

/** A small but complete model: two views, a control, an interface, three relationship kinds and a flow. */
const model: TestModel = {
  'unique-id': 'system',
  name: 'System',
  description: 'A system.',
  metadata: {
    adrs: [
      {
        id: 'ADR-0001',
        title: 'Test code',
        status: 'proposed',
        file: 'docs/decisions/0001-test.md',
        url: 'https://mgasca.github.io/calendar/adr/0001/',
      },
    ],
    stories: [
      {
        id: '0002',
        title: 'Test story',
        status: 'implemented',
        url: 'https://mgasca.github.io/calendar/stories/0002/',
      },
    ],
    views: {
      context: { title: 'Context', description: 'Who uses it.', nodes: ['user', 'app'] },
      containers: {
        title: 'Containers',
        description: 'What runs.',
        nodes: ['user', 'app', 'db', 'host'],
      },
    },
  },
  nodes: [
    {
      'unique-id': 'user',
      'node-type': 'actor',
      name: 'User',
      description: 'A person.',
      metadata: { adrs: ['ADR-0001'], stories: ['0002'] },
    },
    {
      'unique-id': 'app',
      'node-type': 'service',
      name: 'App (web)',
      description: 'The app.',
      interfaces: [{ 'unique-id': 'http', port: 8080, paths: ['/a', '/b'] }],
      controls: {
        auth: {
          description: 'Who may call it.',
          requirements: [
            {
              'requirement-url': requirement,
              config: { scheme: 'cookie', list: ['a', 'b'], nested: { depth: 1 }, on: true },
            },
          ],
        },
      },
      metadata: { adrs: ['ADR-0001'] },
    },
    { 'unique-id': 'db', 'node-type': 'database', name: 'Db', description: 'Rows.' },
    { 'unique-id': 'host', 'node-type': 'system', name: 'Host', description: 'Runs things.' },
  ],
  relationships: [
    {
      'unique-id': 'user-app',
      description: 'Uses',
      'relationship-type': { interacts: { actor: 'user', nodes: ['app'] } },
    },
    {
      'unique-id': 'app-db',
      description: 'Reads; writes (all of it)',
      protocol: 'TCP',
      'relationship-type': {
        connects: { source: { node: 'app', interfaces: ['http'] }, destination: { node: 'db' } },
      },
    },
    {
      'unique-id': 'host-runs',
      'relationship-type': { 'deployed-in': { container: 'host', nodes: ['app', 'db'] } },
    },
  ],
  flows: [
    {
      'unique-id': 'read',
      name: 'Read something',
      description: 'A read.',
      transitions: [
        {
          'relationship-unique-id': 'user-app',
          'sequence-number': 1,
          description: 'Opens the app',
        },
        {
          'relationship-unique-id': 'app-db',
          'sequence-number': 2,
          description: 'Rows come back; all of them (quickly)',
          direction: 'destination-to-source',
        },
      ],
      metadata: { story: '0002', adrs: ['ADR-0001'] },
    },
  ],
};

const adrs: Adr[] = [
  { number: '0001', file: '0001-test.md', title: 'Test code', status: 'proposed', body: '' },
];
const stories: Story[] = [
  {
    number: '0002',
    file: '0002-test-story.md',
    title: 'Test story',
    status: 'implemented',
    date: '2026-10-28',
    pr: [],
    adrs: [],
    body: '',
  },
];
const context = { adrs, stories, mappedUrls: new Set([requirement]) };

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item ${String(index)}`);
  return item;
}
const node = (copy: TestModel, id: string) => {
  const found = copy.nodes.find((item) => item['unique-id'] === id);
  if (!found) throw new Error(`No node ${id}`);
  return found;
};
const relationship = (copy: TestModel, id: string) => {
  const found = copy.relationships.find((item) => item['unique-id'] === id);
  if (!found) throw new Error(`No relationship ${id}`);
  return found;
};
const authRequirement = (copy: TestModel) => {
  const control = node(copy, 'app').controls?.auth;
  if (!control) throw new Error('No auth control');
  return control;
};

/** Parses and checks a deep copy of the model after `mutate` has changed it. */
function check(mutate: (copy: TestModel) => void, references = context) {
  const copy = structuredClone(model);
  mutate(copy);
  const architecture = parseArchitecture(JSON.stringify(copy));
  checkArchitecture(architecture, references);
  return architecture;
}

describe('architecture model', () => {
  it('parses nodes, interfaces, controls, relationship kinds, flows and references', () => {
    const architecture = check(() => undefined);
    expect(architecture.nodes.map((item) => item.id)).toEqual(['user', 'app', 'db', 'host']);
    expect(architecture.nodes[1]?.interfaces[0]).toEqual({
      id: 'http',
      details: { port: 8080, paths: ['/a', '/b'] },
    });
    expect(architecture.nodes[1]?.controls[0]?.requirements[0]?.url).toBe(requirement);
    expect(architecture.relationships.map((item) => item.link.kind)).toEqual([
      'interacts',
      'connects',
      'deployed-in',
    ]);
    expect(architecture.flows[0]?.transitions[1]).toEqual({
      relationship: 'app-db',
      sequence: 2,
      description: 'Rows come back; all of them (quickly)',
      reversed: true,
    });
    expect(architecture.flows[0]?.stories).toEqual(['0002']);
    expect(architecture.adrs[0]?.number).toBe('0001');
  });

  it.each<[string, (copy: TestModel) => void]>([
    ['a duplicate node id', (copy) => copy.nodes.push({ ...node(copy, 'db') })],
    [
      'a relationship to an unknown node',
      (copy) => {
        relationship(copy, 'app-db')['relationship-type'] = {
          connects: { source: { node: 'app' }, destination: { node: 'ghost' } },
        };
      },
    ],
    [
      'a relationship to an unknown interface',
      (copy) => {
        relationship(copy, 'app-db')['relationship-type'] = {
          connects: { source: { node: 'app', interfaces: ['grpc'] }, destination: { node: 'db' } },
        };
      },
    ],
    [
      'two relationship kinds at once',
      (copy) => {
        relationship(copy, 'user-app')['relationship-type'].connects = {
          source: { node: 'user' },
          destination: { node: 'app' },
        };
      },
    ],
    [
      'a deployment into an unknown container',
      (copy) => {
        relationship(copy, 'host-runs')['relationship-type'] = {
          'deployed-in': { container: 'cloud', nodes: ['app'] },
        };
      },
    ],
    [
      'a flow over an unknown relationship',
      (copy) => {
        at(at(copy.flows, 0).transitions, 0)['relationship-unique-id'] = 'nope';
      },
    ],
    [
      'flow steps out of order',
      (copy) => {
        at(at(copy.flows, 0).transitions, 1)['sequence-number'] = 3;
      },
    ],
    [
      'an ADR missing from the decision log',
      (copy) => {
        at(copy.metadata.adrs, 0).id = 'ADR-0009';
      },
    ],
    [
      'an ADR whose status differs from the log',
      (copy) => {
        at(copy.metadata.adrs, 0).status = 'accepted';
      },
    ],
    [
      'an ADR whose title differs from the log',
      (copy) => {
        at(copy.metadata.adrs, 0).title = 'Other';
      },
    ],
    [
      'an ADR whose file differs from the log',
      (copy) => {
        at(copy.metadata.adrs, 0).file = 'docs/decisions/0001-other.md';
      },
    ],
    [
      'an ADR url off the site route',
      (copy) => {
        at(copy.metadata.adrs, 0).url = 'https://example.test/adr/0001/';
      },
    ],
    [
      'an element citing an ADR not in the list',
      (copy) => {
        node(copy, 'user').metadata = { adrs: ['ADR-0002'] };
      },
    ],
    [
      'a malformed ADR reference',
      (copy) => {
        node(copy, 'user').metadata = { adrs: ['0001'] };
      },
    ],
    [
      'a story url that names no card',
      (copy) => {
        at(copy.metadata.stories, 0).url = 'https://mgasca.github.io/calendar/stories/0009/';
      },
    ],
    [
      'a story whose status differs from the card',
      (copy) => {
        at(copy.metadata.stories, 0).status = 'planned';
      },
    ],
    [
      'an element citing a story not in the list',
      (copy) => {
        at(copy.flows, 0).metadata = { story: '0003' };
      },
    ],
    [
      'a view over an unknown node',
      (copy) => {
        copy.metadata.views?.context?.nodes.push('ghost');
      },
    ],
    [
      'a model without views',
      (copy) => {
        delete copy.metadata.views;
      },
    ],
    [
      'a control whose requirement is not mapped',
      (copy) => {
        at(authRequirement(copy).requirements, 0)['requirement-url'] =
          'https://example.test/other.json';
      },
    ],
    [
      'a control without requirements',
      (copy) => {
        authRequirement(copy).requirements = [];
      },
    ],
    [
      'a node without a name',
      (copy) => {
        delete node(copy, 'db').name;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    expect(() => check(mutate)).toThrow();
  });

  it('accepts a superseded ADR whose log status says what superseded it', () => {
    const superseded = { ...at(adrs, 0), status: 'superseded by [ADR-0002](0002-x.md)' };
    expect(() =>
      check(
        (copy) => {
          at(copy.metadata.adrs, 0).status = 'superseded';
        },
        { ...context, adrs: [superseded] },
      ),
    ).not.toThrow();
  });
});

describe('diagram text', () => {
  it('shortens a sentence to its first clause at a word boundary', () => {
    expect(shortLabel('Reads; writes (all of it)')).toBe('Reads');
    expect(shortLabel('Calls GET /api/auth/me: a 401 means no session')).toBe(
      'Calls GET /api/auth/me',
    );
    expect(shortLabel('one two three four five six', 12)).toBe('one two…');
    expect(shortLabel('short')).toBe('short');
  });
  it('escapes the characters Mermaid reads as syntax', () => {
    expect(mermaidText('a; (b) <c> "d" #1')).toBe('a#59; #40;b#41; #lt;c#gt; #quot;d#quot; #35;1');
  });
  it('escapes backslashes before pipes in a table cell, and flattens newlines', () => {
    expect(escapeCell('a|b\\c\nd')).toBe('a\\|b\\\\c d');
    // A backslash before a pipe must not survive as an escape of the pipe's own escape.
    expect(escapeCell('x\\|y')).toBe('x\\\\\\|y');
  });
  it('renders configuration as nested bullets', () => {
    expect(
      renderValue({ scheme: 'cookie', list: ['a', 'b'], nested: { depth: 1 }, on: true }),
    ).toEqual([
      '* **scheme**: cookie',
      '* **list**: a, b',
      '* **nested**:',
      '  * **depth**: 1',
      '* **on**: true',
    ]);
  });
  it('links document paths under docs/ only when given the way to the docs root', () => {
    const metadata = {
      runbook: 'docs/runbooks/azure-database.md',
      runbooks: ['docs/runbooks/azure-bootstrap.md', 'docs/runbooks/azure-infrastructure.md'],
      workflow: '.github/workflows/migrate.yml',
      nested: { record: 'docs/benchmarks/0001-docs-parse.md' },
    };
    expect(renderValue(metadata, 0, '../')).toEqual([
      '* **runbook**: [docs/runbooks/azure-database.md](../runbooks/azure-database.md)',
      '* **runbooks**: [docs/runbooks/azure-bootstrap.md](../runbooks/azure-bootstrap.md), ' +
        '[docs/runbooks/azure-infrastructure.md](../runbooks/azure-infrastructure.md)',
      '* **workflow**: .github/workflows/migrate.yml',
      '* **nested**:',
      '  * **record**: [docs/benchmarks/0001-docs-parse.md](../benchmarks/0001-docs-parse.md)',
    ]);
    expect(renderValue(metadata)).toEqual([
      '* **runbook**: docs/runbooks/azure-database.md',
      '* **runbooks**: docs/runbooks/azure-bootstrap.md, docs/runbooks/azure-infrastructure.md',
      '* **workflow**: .github/workflows/migrate.yml',
      '* **nested**:',
      '  * **record**: docs/benchmarks/0001-docs-parse.md',
    ]);
  });
  it('links the documents named in component and flow metadata from the model directory', () => {
    const architecture = check((copy) => {
      const user = copy.nodes.find((item) => item['unique-id'] === 'user');
      if (user) user.metadata = { ...user.metadata, runbook: 'docs/runbooks/azure-bootstrap.md' };
      const flow = copy.flows[0];
      if (flow) flow.metadata = { ...flow.metadata, record: 'docs/benchmarks/0001-docs-parse.md' };
    });
    const pages = architecturePages(architecture, { stories });
    const body = (id: string) => pages.find((page) => page.id === id)?.body ?? '';
    expect(body('architecture/components/user')).toContain(
      '* **runbook**: [docs/runbooks/azure-bootstrap.md](../runbooks/azure-bootstrap.md)',
    );
    expect(body('architecture/flows/read')).toContain(
      '* **record**: [docs/benchmarks/0001-docs-parse.md](../benchmarks/0001-docs-parse.md)',
    );
  });
});

describe('architecture pages', () => {
  const architecture = check(() => undefined);
  const pages = architecturePages(architecture, { stories });
  const page = (id: string) => {
    const found = pages.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`No page ${id}`);
    return found;
  };

  it('renders an overview, the container view, a components index and page per node, controls and a page per flow', () => {
    expect(pages.map((item) => item.id)).toEqual([
      'architecture',
      'architecture/containers',
      'architecture/components',
      'architecture/components/user',
      'architecture/components/app',
      'architecture/components/db',
      'architecture/components/host',
      'architecture/controls',
      'architecture/flows/read',
    ]);
    expect(pages.filter((item) => item.sidebar.hidden).map((item) => item.id)).toEqual(
      pages.filter((item) => item.id.startsWith('architecture/components/')).map((item) => item.id),
    );
  });

  it('collapses the context diagram onto the view nodes and drops edges that leave the view', () => {
    const body = page('architecture').body;
    expect(body).toContain('flowchart LR');
    expect(body).toContain('user([User])');
    expect(body).toContain('user -->|"Uses"| app');
    expect(body).not.toContain('db');
    expect(body).toContain('[ADR-0001](../decisions/0001-test.md)');
  });

  it('nests the container diagram by deployment and labels edges with the protocol', () => {
    const body = page('architecture/containers').body;
    expect(body).toContain('subgraph host["Host"]');
    expect(body).toContain('db[(Db)]');
    expect(body).toContain('app -->|TCP| db');
    expect(body).toContain(
      '| [App (web)](pages/components/app.md) | runs in | [Host](pages/components/host.md) |',
    );
  });

  it('draws a flow as a sequence diagram with reversed steps, and lists every step in a table', () => {
    const body = page('architecture/flows/read').body;
    expect(body).toContain('participant app as App #40;web#41;');
    expect(body).toContain('user ->> app: 1. Opens the app');
    expect(body).toContain('db -->> app: 2. Rows come back');
    expect(body).toContain(
      '| 2 | [Db](pages/components/db.md) | [App (web)](pages/components/app.md) | Rows come back; all of them (quickly) |',
    );
    expect(body).toContain('[0002 Test story](../stories/0002-test-story.md)');
  });

  it('gives a component its interfaces, relationships, controls and decisions', () => {
    const body = page('architecture/components/app').body;
    expect(body).toContain('| `http` | **port**: 8080; **paths**: /a, /b |');
    expect(body).toContain('### auth');
    expect(body).toContain(`Requirement schema: <${requirement}>`);
    expect(body).toContain('* **scheme**: cookie');
    expect(body).toContain('[ADR-0001](../decisions/0001-test.md) Test code (proposed)');
  });

  it('lists every control with where it applies', () => {
    const body = page('architecture/controls').body;
    expect(body).toContain('| `auth` | [App (web)](pages/components/app.md) |');
    expect(body).toContain('## auth');
  });

  it('maps page ids to routes and to the paths links resolve through', () => {
    expect(pageRoute('architecture')).toBe('architecture/');
    expect(pagePath('architecture')).toBe('docs/architecture/pages/index.md');
    expect(pagePath('architecture/flows/read')).toBe('docs/architecture/pages/flows/read.md');
    expect(architectureSidebar(architecture.flows)).toEqual([
      { slug: 'architecture' },
      { slug: 'architecture/containers' },
      { slug: 'architecture/components' },
      { slug: 'architecture/controls' },
      { label: 'Flows', items: [{ slug: 'architecture/flows/read' }] },
    ]);
  });
});

describe('calm validate gate', () => {
  // The CLI takes a few seconds to start, so this one test gets a longer timeout. It proves that the
  // `just lint` step fails on a model that breaks the CALM schema (ADR-0039 confirmation).
  it('fails on a model with a schema error and a dangling relationship', async () => {
    const calm = fileURLToPath(new URL('../../node_modules/.bin/calm', import.meta.url));
    const fixture = fileURLToPath(new URL('fixtures/invalid.architecture.json', import.meta.url));
    await expect(
      promisify(execFile)(calm, [
        'validate',
        '--architecture',
        fixture,
        '--strict',
        '--format',
        'json',
      ]),
    ).rejects.toMatchObject({ code: 1 });
  }, 30_000);
});
