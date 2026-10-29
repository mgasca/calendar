#!/usr/bin/env -S dotnet run
#:include Infrastructure.cs
#:include Database.cs
#:package Npgsql@10.0.3

using InfraTool;
using System.Runtime.InteropServices;

using var cancellation = new CancellationTokenSource();
using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; cancellation.Cancel(); });
using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; cancellation.Cancel(); });
return await Infra.RunAsync(args, new AzureProcess(cancellation.Token), Console.Out, Console.Error, cancellation.Token);
