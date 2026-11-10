# The build caller supplies the Node major from frontend/.node-version.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS web
WORKDIR /src/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/apps/web/package.json apps/web/
COPY frontend/apps/docs/package.json apps/docs/
COPY frontend/packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter @calendar/web...
COPY frontend/ ./
RUN pnpm --filter @calendar/web build

FROM mcr.microsoft.com/dotnet/sdk:11.0@sha256:65f3c7c6a25a239ab3e6719f2896147e7b68242ff2d8818dd70498bde6ef8bea AS build
WORKDIR /src/backend
COPY .editorconfig /src/.editorconfig
COPY backend/global.json backend/Directory.Build.props backend/Directory.Packages.props backend/NuGet.config backend/SonarLint.xml ./
COPY backend/src/Directory.Build.props backend/src/BannedSymbols.txt src/
COPY backend/src/Calendar.Api/*.csproj backend/src/Calendar.Api/packages.lock.json src/Calendar.Api/
COPY backend/src/Calendar.Domain/*.csproj backend/src/Calendar.Domain/packages.lock.json src/Calendar.Domain/
COPY backend/src/Calendar.Infrastructure/*.csproj backend/src/Calendar.Infrastructure/packages.lock.json src/Calendar.Infrastructure/
RUN dotnet restore src/Calendar.Api --locked-mode
COPY backend/src/ src/
RUN dotnet publish src/Calendar.Api -c Release --no-restore --no-self-contained -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:1a48394b6f29d3a32c79d9edecd4abda0ecbe8776d567dbfc4590ed6979c740c AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=build /out/ ./
COPY --from=web /src/frontend/apps/web/dist/ ./wwwroot/
USER $APP_UID
ENTRYPOINT ["dotnet", "Calendar.Api.dll"]
