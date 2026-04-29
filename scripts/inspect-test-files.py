#!/usr/bin/env python3
"""Scan ../test-files/**/*.ifc and report georef status as markdown.

Reads STEP text directly — no ifcopenshell dependency. For each file,
extracts: schema, length unit, IfcSite ref lat/lon/elevation, TrueNorth,
IfcMapConversion + IfcProjectedCRS (IFC4+), ePset_MapConversion +
ePset_ProjectedCRS (IFC2X3).
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "test-files"

# STEP entity regexes — permissive on whitespace.
ENT_RE = re.compile(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(", re.IGNORECASE)


def read_entities(text: str):
    """Yield (id, entity_name, body) tuples. `body` is the full arg string
    between the opening `(` and the matching `);` (handling nested parens
    and strings)."""
    for match in ENT_RE.finditer(text):
        ent_id = int(match.group(1))
        ent_name = match.group(2).upper()
        start = match.end()
        depth = 1
        i = start
        in_str = False
        while i < len(text) and depth > 0:
            c = text[i]
            if in_str:
                if c == "'":
                    # STEP escapes '' as a literal apostrophe; skip both.
                    if i + 1 < len(text) and text[i + 1] == "'":
                        i += 2
                        continue
                    in_str = False
            else:
                if c == "'":
                    in_str = True
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
            i += 1
        body = text[start : i - 1]
        yield ent_id, ent_name, body


def split_args(body: str):
    """STEP-aware split of a top-level comma-separated arg list."""
    out = []
    depth = 0
    in_str = False
    cur = []
    i = 0
    while i < len(body):
        c = body[i]
        if in_str:
            cur.append(c)
            if c == "'":
                if i + 1 < len(body) and body[i + 1] == "'":
                    cur.append(body[i + 1])
                    i += 2
                    continue
                in_str = False
        else:
            if c == "'":
                in_str = True
                cur.append(c)
            elif c == "(":
                depth += 1
                cur.append(c)
            elif c == ")":
                depth -= 1
                cur.append(c)
            elif c == "," and depth == 0:
                out.append("".join(cur).strip())
                cur = []
                i += 1
                continue
            else:
                cur.append(c)
        i += 1
    if cur:
        out.append("".join(cur).strip())
    return out


def strip_str(s: str) -> str:
    s = s.strip()
    if s.startswith("'") and s.endswith("'"):
        return s[1:-1].replace("''", "'")
    return s


def parse_dms_list(arg: str):
    """Parse an IfcCompoundPlaneAngleMeasure like `(52, 22, 5, 0)` into decimal."""
    arg = arg.strip()
    if not (arg.startswith("(") and arg.endswith(")")):
        return None
    parts = [p.strip() for p in arg[1:-1].split(",")]
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) < 3:
        return None
    d, m, s = nums[0], nums[1], nums[2]
    micro = nums[3] if len(nums) > 3 else 0
    sign = -1 if any(x < 0 for x in (d, m, s, micro)) else 1
    return sign * (abs(d) + abs(m) / 60 + (abs(s) + abs(micro) / 1e6) / 3600)


def resolve_ref(arg: str):
    """If arg is `#123`, return int(123); else None."""
    arg = arg.strip()
    if arg.startswith("#"):
        try:
            return int(arg[1:])
        except ValueError:
            return None
    return None


def resolve_value(arg: str, entities: dict) -> str:
    """Unwrap IFCLABEL('X') / IFCLENGTHMEASURE(1.0) etc. or chase one ref."""
    arg = arg.strip()
    if arg.startswith("#"):
        ref = resolve_ref(arg)
        if ref is not None and ref in entities:
            _, body = entities[ref]
            parts = split_args(body)
            if len(parts) == 1:
                return strip_str(parts[0])
        return arg
    if "(" in arg and arg.endswith(")"):
        inner = arg[arg.index("(") + 1 : -1].strip()
        return strip_str(inner)
    return strip_str(arg)


def analyze(path: Path) -> dict:
    text = path.read_text(errors="replace")

    schema_match = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'\s*\)\s*\)", text)
    schema = schema_match.group(1) if schema_match else "?"

    # Build (id -> (name, body)) map for all lines.
    entities: dict[int, tuple[str, str]] = {}
    by_type: dict[str, list[int]] = {}
    for ent_id, name, body in read_entities(text):
        entities[ent_id] = (name, body)
        by_type.setdefault(name, []).append(ent_id)

    info: dict = {"schema": schema, "entity_counts": {k: len(v) for k, v in by_type.items()}}

    # -------- length unit --------
    length_unit = None
    for si_id in by_type.get("IFCSIUNIT", []):
        _, body = entities[si_id]
        args = split_args(body)
        # IfcSIUnit(Dimensions, UnitType, Prefix, Name)
        if len(args) >= 4 and args[1].strip().strip(".").upper() == "LENGTHUNIT":
            prefix = args[2].strip().strip(".")
            name = args[3].strip().strip(".")
            if prefix and prefix != "$":
                length_unit = f"{prefix}{name}"
            else:
                length_unit = name
            break
    info["length_unit"] = length_unit

    # -------- IfcSite ref lat/lon/elevation + local origin --------
    sites = by_type.get("IFCSITE", [])
    site_info = None
    if sites:
        _, body = entities[sites[0]]
        args = split_args(body)
        # IfcSite(GlobalId, OwnerHistory, Name, Description, ObjectType,
        #         ObjectPlacement, Representation, LongName, CompositionType,
        #         RefLatitude, RefLongitude, RefElevation, LandTitleNumber, SiteAddress)
        if len(args) >= 12:
            ref_lat_arg = args[9].strip()
            ref_lon_arg = args[10].strip()
            ref_elev_arg = args[11].strip()
            lat = parse_dms_list(ref_lat_arg) if ref_lat_arg != "$" else None
            lon = parse_dms_list(ref_lon_arg) if ref_lon_arg != "$" else None
            elev = None
            if ref_elev_arg != "$":
                try:
                    elev = float(ref_elev_arg)
                except ValueError:
                    pass
            placement_ref = resolve_ref(args[5])
            local_origin = None
            if placement_ref and placement_ref in entities:
                _, pbody = entities[placement_ref]
                pargs = split_args(pbody)
                # IfcLocalPlacement(PlacementRelTo, RelativePlacement)
                if len(pargs) >= 2:
                    rel_ref = resolve_ref(pargs[1])
                    if rel_ref and rel_ref in entities:
                        _, rbody = entities[rel_ref]
                        rargs = split_args(rbody)
                        # IfcAxis2Placement3D(Location, Axis, RefDirection)
                        if rargs:
                            loc_ref = resolve_ref(rargs[0])
                            if loc_ref and loc_ref in entities:
                                _, lbody = entities[loc_ref]
                                largs = split_args(lbody)
                                # IfcCartesianPoint(Coordinates)
                                if largs and largs[0].startswith("("):
                                    coords = [c.strip() for c in largs[0][1:-1].split(",")]
                                    try:
                                        local_origin = tuple(float(c) for c in coords[:3])
                                    except ValueError:
                                        pass
            site_info = {
                "latitude": lat,
                "longitude": lon,
                "elevation": elev,
                "local_origin": local_origin,
            }
    info["site"] = site_info

    # -------- TrueNorth --------
    true_north = None
    for ctx_id in by_type.get("IFCGEOMETRICREPRESENTATIONCONTEXT", []):
        _, body = entities[ctx_id]
        args = split_args(body)
        # IfcGeometricRepresentationContext(Identifier, ContextType,
        #   CoordinateSpaceDimension, Precision, WorldCoordinateSystem, TrueNorth)
        if len(args) >= 6 and args[5].strip() != "$":
            ref = resolve_ref(args[5])
            if ref and ref in entities:
                _, dbody = entities[ref]
                dargs = split_args(dbody)
                # IfcDirection(DirectionRatios)
                if dargs and dargs[0].startswith("("):
                    ratios = [r.strip() for r in dargs[0][1:-1].split(",")]
                    try:
                        nums = [float(r) for r in ratios]
                        true_north = nums
                        break
                    except ValueError:
                        pass
    info["true_north"] = true_north

    # -------- IfcMapConversion / IfcProjectedCRS (IFC4+) --------
    map_conv = None
    for mc_id in by_type.get("IFCMAPCONVERSION", []):
        _, body = entities[mc_id]
        args = split_args(body)
        # IfcMapConversion(SourceCRS, TargetCRS, Eastings, Northings,
        #                  OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale)
        if len(args) < 8:
            continue
        target_ref = resolve_ref(args[1])
        target_name = None
        if target_ref and target_ref in entities:
            _, tbody = entities[target_ref]
            targs = split_args(tbody)
            if targs:
                target_name = strip_str(targs[0])

        def num(a):
            try:
                return float(a.strip())
            except ValueError:
                return None

        map_conv = {
            "target_crs": target_name,
            "eastings": num(args[2]),
            "northings": num(args[3]),
            "orthogonal_height": num(args[4]),
            "x_abscissa": num(args[5]) if args[5].strip() != "$" else None,
            "x_ordinate": num(args[6]) if args[6].strip() != "$" else None,
            "scale": num(args[7]) if args[7].strip() != "$" else None,
        }
        break
    info["map_conversion"] = map_conv

    # -------- ePset_MapConversion / ePset_ProjectedCRS (IFC2X3) --------
    def read_pset(pset_id: int):
        _, body = entities[pset_id]
        args = split_args(body)
        # IfcPropertySet(GlobalId, OwnerHistory, Name, Description, HasProperties)
        if len(args) < 5:
            return None, {}
        name = strip_str(args[2])
        has = args[4].strip()
        if not (has.startswith("(") and has.endswith(")")):
            return name, {}
        refs = [r.strip() for r in has[1:-1].split(",")]
        out = {}
        for r in refs:
            rid = resolve_ref(r)
            if rid is None or rid not in entities:
                continue
            rname, rbody = entities[rid]
            if rname != "IFCPROPERTYSINGLEVALUE":
                continue
            rargs = split_args(rbody)
            if len(rargs) < 3:
                continue
            pname = strip_str(rargs[0])
            pval = resolve_value(rargs[2], entities)
            out[pname] = pval
        return name, out

    epset_map_conv = None
    epset_projected_crs = None
    for pset_id in by_type.get("IFCPROPERTYSET", []):
        name, props = read_pset(pset_id)
        if not name:
            continue
        lname = name.lower()
        if lname == "epset_mapconversion":
            epset_map_conv = props
        elif lname == "epset_projectedcrs":
            epset_projected_crs = props
    info["epset_map_conversion"] = epset_map_conv
    info["epset_projected_crs"] = epset_projected_crs

    return info


def fmt(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


def render(path: Path, info: dict) -> str:
    rel = path.relative_to(ROOT)
    size = path.stat().st_size
    size_h = (
        f"{size / 1024 / 1024:.1f} MB"
        if size >= 1024 * 1024
        else f"{size / 1024:.0f} KB"
    )
    lines = [f"### `{rel}`", ""]
    lines.append(f"- **Size:** {size_h}")
    lines.append(f"- **Schema:** {info['schema']}")
    lines.append(f"- **Length unit:** {fmt(info['length_unit'])}")

    site = info["site"]
    if site:
        lines.append(
            f"- **IfcSite RefLatitude/RefLongitude:** "
            f"{fmt(site['latitude'])}, {fmt(site['longitude'])}  "
            f"(elev {fmt(site['elevation'])})"
        )
        lines.append(f"- **IfcSite local origin:** {fmt(site['local_origin'])}")
    else:
        lines.append("- **IfcSite:** not found")

    tn = info["true_north"]
    if tn is None:
        lines.append("- **TrueNorth:** default (0, 1)")
    else:
        lines.append(f"- **TrueNorth DirectionRatios:** {tn}")

    mc = info["map_conversion"]
    if mc:
        lines.append("- **IfcMapConversion:**")
        lines.append(f"    - TargetCRS: `{mc['target_crs']}`")
        lines.append(
            f"    - Eastings {fmt(mc['eastings'])}, "
            f"Northings {fmt(mc['northings'])}, "
            f"OrthogonalHeight {fmt(mc['orthogonal_height'])}"
        )
        lines.append(
            f"    - XAxisAbscissa {fmt(mc['x_abscissa'])}, "
            f"XAxisOrdinate {fmt(mc['x_ordinate'])}, "
            f"Scale {fmt(mc['scale'])}"
        )

    epm = info["epset_map_conversion"]
    epc = info["epset_projected_crs"]
    if epm or epc:
        lines.append("- **ePset_MapConversion / ePset_ProjectedCRS:**")
        if epc:
            lines.append(f"    - ePset_ProjectedCRS: {epc}")
        if epm:
            lines.append(f"    - ePset_MapConversion: {epm}")

    # Verdict
    has_mc = mc is not None or epm is not None
    has_site_ref = site and site["latitude"] is not None and site["longitude"] is not None
    if has_mc:
        verdict = "**Georeferenced (Level 50).**"
    elif has_site_ref:
        verdict = "**Partially georeferenced (Level 30 — IfcSite lat/lon only).**"
    else:
        verdict = "**Not georeferenced.**"
    lines.append(f"- **Verdict:** {verdict}")
    lines.append("")
    return "\n".join(lines)


def main():
    files = sorted(ROOT.rglob("*.ifc"))
    if not files:
        print(f"No .ifc files under {ROOT}", file=sys.stderr)
        return 1
    parts = [
        "# Test files: georeferencing status",
        "",
        "Auto-generated by `scripts/inspect-test-files.py`. Parses the STEP text directly; no ifcopenshell dependency.",
        "",
        "**Georeferencing levels** (per buildingSMART User Guide):",
        "- Level 30 — IfcSite RefLatitude/RefLongitude only.",
        "- Level 40 — adds IfcProjectedCRS (target CRS name), no transform.",
        "- Level 50 — adds IfcMapConversion (full Helmert transform to target CRS).",
        "",
    ]
    for path in files:
        info = analyze(path)
        parts.append(render(path, info))
    out = "\n".join(parts)
    print(out)


if __name__ == "__main__":
    raise SystemExit(main())
