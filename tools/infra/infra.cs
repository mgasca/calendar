#!/usr/bin/env -S dotnet run
#:include Infrastructure.cs
#:include Database.cs
#:package Npgsql@10.0.3

using InfraTool;

return await Infra.RunAsync(args, new AzureProcess(), Console.Out, Console.Error);
