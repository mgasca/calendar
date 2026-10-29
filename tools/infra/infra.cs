#!/usr/bin/env -S dotnet run
#:include Infrastructure.cs

using InfraTool;

return await Infra.RunAsync(args, new AzureProcess(), Console.Out, Console.Error);
