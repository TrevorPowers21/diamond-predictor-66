"""
Generate a baseball field SVG asset using baseball-field-viz.

Home plate sits at origin (0, 0). +y goes upfield toward center field
(so +y at distance d, angle 0 = (0, d)). Left field is -x, right field
is +x. Foul lines at ±45°.

Output: public/baseball-field.svg — used as a static background image
by SprayField.tsx. The React component overlays data points at the
same coordinate space (after converting spray_ang + distance → x, y).

To regenerate (after tweaking foul_distance or outfield_distance):
    python3 scripts/python/generate_field_svg.py
"""

import json
import math
import os
import sys

import matplotlib.pyplot as plt
from baseball_field_viz import draw_field

# College / TruMedia-faithful proportions. 330ft foul lines, ~400ft to
# center; baseball-field-viz's `outfield_distance` is the WALL distance
# (the radius of the outfield arc), not the deepest CF point. Setting it
# slightly above the foul-pole distance keeps the wall visible.
FOUL_DISTANCE = 330
OUTFIELD_DISTANCE = 400

OUT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "public",
    "baseball-field.svg",
)


def main() -> None:
    fig, ax = plt.subplots(figsize=(4, 5))
    draw_field(ax, foul_distance=FOUL_DISTANCE, outfield_distance=OUTFIELD_DISTANCE)

    # Clean up axes — we want pure field geometry, no chrome
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_aspect("equal")
    ax.set_facecolor("white")
    fig.patch.set_facecolor("white")
    fig.tight_layout(pad=0)

    # Lock the viewBox so React knows the coordinate system. We tighten X
    # to the actual horizontal extent of the field (foul poles at
    # ±foul_distance·sin(45°)) so the SVG renders in proper portrait
    # orientation, not landscape.
    x_extent = FOUL_DISTANCE * math.sin(math.pi / 4)
    margin = 18
    x_min, x_max = -x_extent - margin, x_extent + margin
    y_min, y_max = -margin, OUTFIELD_DISTANCE + margin
    ax.set_xlim(x_min, x_max)
    ax.set_ylim(y_min, y_max)

    # Resolve output path + ensure /public exists
    out = os.path.abspath(OUT_PATH)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.savefig(out, format="svg", bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)

    # Emit coordinate metadata alongside the SVG so React knows where home
    # plate sits and how to scale data points. (x_min, y_min, x_max, y_max)
    # is the matplotlib axes extent in FEET. The SVG renders this as a viewBox
    # with home plate (data 0,0) at a known fractional position.
    # Inside the SVG, matplotlib's transform inverts Y (matplotlib y-up → SVG
    # y-down). Home plate fractional position in viewBox: (cx, cy) = ((0 - x_min) / (x_max - x_min), (y_max - 0) / (y_max - y_min)).
    home_frac_x = (0.0 - x_min) / (x_max - x_min)
    home_frac_y = (y_max - 0.0) / (y_max - y_min)
    meta = {
        "foul_distance_ft": FOUL_DISTANCE,
        "outfield_distance_ft": OUTFIELD_DISTANCE,
        "axes_extent_ft": {
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
        },
        # Fraction of the viewBox where home plate sits. Multiply by the
        # card pixel dimensions to find home plate in screen coords.
        "home_plate_fraction": {
            "x": home_frac_x,
            "y": home_frac_y,
        },
        # Feet per fractional unit. To position a ball at (spray_ang_deg,
        # distance_ft), React computes:
        #   x_ft = distance * sin(spray_ang_rad)
        #   y_ft = distance * cos(spray_ang_rad)
        #   x_frac = home_frac_x + (x_ft / ft_per_fraction_x)
        #   y_frac = home_frac_y - (y_ft / ft_per_fraction_y)
        "ft_per_fraction": {
            "x": x_max - x_min,
            "y": y_max - y_min,
        },
        "projection": "x = distance * sin(spray_ang_rad), y = distance * cos(spray_ang_rad)",
        "spray_ang_convention": "TruMedia: 0 = straight CF, negative = LF (3B side), positive = RF (1B side); foul lines at ±45°",
    }
    meta_path = os.path.join(os.path.dirname(out), "baseball-field-meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"✅ wrote {out}")
    print(f"✅ wrote {meta_path}")
    print()
    print("Coordinate system (for React overlay):")
    print(f"  Home plate at data (0, 0)")
    print(f"  X range (ft): [{x_min:.0f}, {x_max:.0f}]")
    print(f"  Y range (ft): [{y_min:.0f}, {y_max:.0f}]")
    print(f"  Home plate fraction in viewBox: ({home_frac_x:.4f}, {home_frac_y:.4f})")
    print(f"  Feet per fraction: x={x_max - x_min:.0f}, y={y_max - y_min:.0f}")


if __name__ == "__main__":
    sys.exit(main())
