#!/usr/bin/env python3
"""Build a .vsix without `vsce` (the npm registry is firewalled in this sandbox).

A .vsix is an OPC zip: an `extension/` folder with the shipped files, plus
`extension.vsixmanifest` and `[Content_Types].xml` at the root. This mirrors
what `vsce package` would emit given our .vscodeignore.
"""
import json
import os
import zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_pkg():
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
        return json.load(f)


def collect_files():
    """(abs_path, archive_path) pairs for everything we ship."""
    files = []

    def add(rel_src, arc=None):
        src = os.path.join(ROOT, rel_src)
        files.append((src, "extension/" + (arc or rel_src)))

    add("package.json")
    add("README.md")
    add("INSTALL.md")
    add("LICENSE", "LICENSE.txt")
    add("resources/icon.png")
    add("resources/vibe-warden.svg")

    # Compiled extension (no source maps, no tests).
    out_src = os.path.join(ROOT, "out", "src")
    for dirpath, _dirs, names in os.walk(out_src):
        for name in names:
            if name.endswith(".js"):
                p = os.path.join(dirpath, name)
                add(os.path.relpath(p, ROOT))

    # Production dependencies.
    for dep in ("ignore", "jsonc-parser"):
        base = os.path.join(ROOT, "node_modules", dep)
        for dirpath, _dirs, names in os.walk(base):
            for name in names:
                p = os.path.join(dirpath, name)
                add(os.path.relpath(p, ROOT))

    return files


def vsixmanifest(pkg):
    repo = (pkg.get("repository") or {}).get("url", "")
    tags = ",".join(pkg.get("keywords", []))
    cats = ",".join(pkg.get("categories", []))
    desc = escape(pkg.get("description", ""))
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
\t<Metadata>
\t\t<Identity Language="en-US" Id="{pkg['name']}" Version="{pkg['version']}" Publisher="{pkg['publisher']}" />
\t\t<DisplayName>{escape(pkg.get('displayName', pkg['name']))}</DisplayName>
\t\t<Description xml:space="preserve">{desc}</Description>
\t\t<Tags>{escape(tags)}</Tags>
\t\t<Categories>{escape(cats)}</Categories>
\t\t<GalleryFlags>Public</GalleryFlags>
\t\t<Properties>
\t\t\t<Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(pkg['engines']['vscode'])}" />
\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="{escape(repo)}" />
\t\t</Properties>
\t</Metadata>
\t<Installation>
\t\t<InstallationTarget Id="Microsoft.VisualStudio.Code" />
\t</Installation>
\t<Dependencies />
\t<Assets>
\t\t<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
\t\t<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
\t\t<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
\t\t<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/resources/icon.png" Addressable="true" />
\t</Assets>
</PackageManifest>
"""


CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
\t<Default Extension="json" ContentType="application/json" />
\t<Default Extension="js" ContentType="application/javascript" />
\t<Default Extension="map" ContentType="application/json" />
\t<Default Extension="ts" ContentType="application/typescript" />
\t<Default Extension="md" ContentType="text/markdown" />
\t<Default Extension="txt" ContentType="text/plain" />
\t<Default Extension="png" ContentType="image/png" />
\t<Default Extension="svg" ContentType="image/svg+xml" />
\t<Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
"""


def main():
    pkg = read_pkg()
    out = os.path.join(ROOT, f"{pkg['name']}-{pkg['version']}.vsix")
    files = collect_files()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("extension.vsixmanifest", vsixmanifest(pkg))
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        for src, arc in files:
            z.write(src, arc)
    print(f"wrote {out}  ({len(files)} files)")


if __name__ == "__main__":
    main()
