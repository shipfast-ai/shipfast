/**
 * .csproj scanner — .NET project file (XML).
 *
 * Only needs PackageReference elements. Regex-based to avoid an XML parser dep.
 */

'use strict';

function scan(contents, filePath /*, cwd */) {
  if (!contents) return {};
  const deps = [];
  const signals = {};

  // Target framework
  const tfm = contents.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
  if (tfm) signals.dotnet_target = tfm[1].trim();
  const tfms = contents.match(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/);
  if (tfms) signals.dotnet_targets = tfms[1].trim().split(';').map(s => s.trim());

  // <PackageReference Include="X" Version="1.2.3" />
  // <PackageReference Include="X"><Version>1.2.3</Version></PackageReference>
  const refRe = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = refRe.exec(contents)) !== null) {
    deps.push({ ecosystem: 'nuget', name: m[1], version: m[2], kind: 'runtime' });
  }
  const refRe2 = /<PackageReference\s+Include="([^"]+)"[^>]*>\s*<Version>([^<]+)<\/Version>/g;
  while ((m = refRe2.exec(contents)) !== null) {
    deps.push({ ecosystem: 'nuget', name: m[1], version: m[2], kind: 'runtime' });
  }

  return { deps, signals };
}

module.exports = {
  // Accept any .csproj file; register by suffix — but our registry matches by exact
  // filename. Use a sentinel + let the registry handle it via a helper call path.
  // For now, match common fixed names users often have:
  filenames: [],
  // Hook: the registry will additionally call this with any file whose name ends in .csproj
  // We express that via a special matcher property (see registry for support).
  matchSuffix: '.csproj',
  scan,
};
