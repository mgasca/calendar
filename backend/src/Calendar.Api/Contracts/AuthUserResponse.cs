namespace Calendar.Api.Contracts;

internal sealed record AuthUserResponse(string Name, string Email, string? PictureUrl);
