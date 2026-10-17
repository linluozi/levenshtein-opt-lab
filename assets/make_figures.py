#!/usr/bin/env python
"""Generate the figures in assets/ from benchmarks/results.json.

Rules followed here, all of them learned the hard way:

* Plot *ratios*, never bare milliseconds. Absolute wall-clock drifts several
  times over across cases inside a single process (allocator state accumulates),
  so a millisecond axis produces curves whose shape is measurement artefact.
* Show the noise floor. Every attribution chart carries the null-control band,
  because a ratio of 1.05 means nothing if the same function measured against
  itself already spreads to 1.10.
* Warm editorial palette: espresso brown / amber gold / terracotta.

Run with an interpreter that has matplotlib:
    python assets/make_figures.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RESULTS = json.loads((ROOT / "benchmarks" / "results.json").read_text(encoding="utf-8"))
SWAP = json.loads((ROOT / "benchmarks" / "swap-probe.json").read_text(encoding="utf-8"))
OUT = ROOT / "assets"

INK = "#2b2119"
PAPER = "#faf6f0"
AMBER = "#c8892b"
TERRACOTTA = "#b4552f"
OLIVE = "#6b6b3a"
MUTED = "#8a7a68"
GRID = "#ddd2c4"

plt.rcParams.update({
    "figure.facecolor": PAPER,
    "axes.facecolor": PAPER,
    "axes.edgecolor": INK,
    "axes.labelcolor": INK,
    "text.color": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "font.size": 10,
    "font.family": "DejaVu Sans",
    "axes.grid": True,
    "grid.color": GRID,
    "grid.linewidth": 0.6,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "legend.frameon": False,
})


def equal_cases():
    return [c for c in RESULTS["cases"] if c["shortSize"] is None]


def noise_floor():
    """Spread of the null-control *medians* across cases.

    Deliberately uses the median per case, not the per-round extremes: a single
    round can spike 20% on a noisy machine, and drawing that as "the noise floor"
    would make the band so wide that every real effect disappears inside it.
    The median spread is the honest threshold for a median-of-ratios statistic.
    """
    meds = [c["nullControl"]["median"] for c in RESULTS["cases"]]
    return min(meds), max(meds)


def noise_floor_wide():
    """Per-round extremes, for the footnote only."""
    lo = min(c["nullControl"]["min"] for c in RESULTS["cases"])
    hi = max(c["nullControl"]["max"] for c in RESULTS["cases"])
    return lo, hi


def fig_four_arms() -> None:
    """Left: absolute speedup per arm. Right: the same data as adjacent ratios.

    The right panel is the point of the whole repo: it shows that D/A looks
    like one number but is really three, and that the smallest of the three
    (D/C, the argument swap) is the only one that changes memory complexity.
    """
    cases = equal_cases()
    ns = [c["n"] for c in cases]
    keys = ["B", "C", "D"]
    labels = {
        "B": "B: + micro-opt (hoist rows, packed)",
        "C": "C: + two-row rolling array",
        "D": "D: + argument swap (shipped)",
    }
    colors = {"B": MUTED, "C": OLIVE, "D": AMBER}

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.2, 4.9))

    for k in keys:
        vals = [c["arms"][k]["ratioMedian"] for c in cases]
        lo = [c["arms"][k]["ratioMedian"] - c["arms"][k]["ratioP10"] for c in cases]
        hi = [c["arms"][k]["ratioP90"] - c["arms"][k]["ratioMedian"] for c in cases]
        ax1.errorbar(
            ns, vals, yerr=[lo, hi], marker="o", markersize=5, capsize=3,
            linewidth=1.8, color=colors[k], label=labels[k],
        )

    lo_n, hi_n = noise_floor()
    ax1.axhspan(lo_n, hi_n, color=TERRACOTTA, alpha=0.13, zorder=0)
    ax1.axhline(1.0, color=INK, linewidth=0.8, linestyle=":", zorder=1)
    ax1.set_xscale("log")
    ax1.set_xlabel("string length n (equal-length input)")
    ax1.set_ylabel("speedup vs upstream (median of per-round ratios)")
    ax1.set_title("Cumulative speedup by arm", loc="left", fontsize=11)
    ax1.legend(loc="upper left", fontsize=8.5)
    ax1.annotate(
        f"null control band {lo_n:.2f}-{hi_n:.2f}",
        xy=(ns[0], hi_n), xytext=(ns[0] * 1.05, hi_n + 0.35),
        fontsize=8, color=TERRACOTTA,
    )

    # Adjacent ratios: each bar is the pair of arms that isolates one change.
    pairs = [
        ("B/A", "micro-opt\n(hoist + packed)", [c["arms"]["B"]["ratioMedian"] for c in cases], MUTED),
        ("C/B", "two-row\nrolling array",
         [c["arms"]["C"]["ratioMedian"] / c["arms"]["B"]["ratioMedian"] for c in cases], OLIVE),
        ("D/C", "argument\nswap",
         [c["arms"]["D"]["ratioMedian"] / c["arms"]["C"]["ratioMedian"] for c in cases], AMBER),
    ]

    x = range(len(cases))
    width = 0.26
    for idx, (name, desc, vals, color) in enumerate(pairs):
        offsets = [i + (idx - 1) * width for i in x]
        ax2.bar(offsets, vals, width=width * 0.92, color=color, label=f"{name}  {desc}")

    ax2.axhline(1.0, color=INK, linewidth=1.0)
    ax2.axhspan(lo_n, hi_n, color=TERRACOTTA, alpha=0.13, zorder=0)
    ax2.set_xticks(list(x))
    ax2.set_xticklabels([str(n) for n in ns])
    ax2.set_xlabel("string length n")
    ax2.set_ylabel("ratio (isolated contribution)")
    ax2.set_title("Adjacent ratios: what each change is worth", loc="left", fontsize=11)
    ax2.set_ylim(0, 2.95)
    ax2.legend(loc="upper center", bbox_to_anchor=(0.5, 1.0), fontsize=8, ncol=1,
               handlelength=1.6, borderaxespad=0.4)

    fig.suptitle(
        "Levenshtein: the headline 3x is three separate changes, not one",
        x=0.008, ha="left", fontsize=12.5, color=INK,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(OUT / "four-arms.png", dpi=180)
    plt.close(fig)


def fig_memory() -> None:
    """Cells stored, and the measured OOM cliff under a 16 MiB heap cap."""
    ns = [100, 200, 500, 1000, 2000, 5000]
    full = [(n + 1) ** 2 for n in ns]
    two = [2 * (n + 1) for n in ns]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.2, 4.2))

    ax1.plot(ns, full, marker="o", color=TERRACOTTA, linewidth=1.8,
             label="upstream: full matrix (n+1)(m+1)  -  4,004,001 cells at n=2000")
    ax1.plot(ns, two, marker="s", color=OLIVE, linewidth=1.8,
             label="shipped: two rows, 2(min+1)  -  4,002 cells at n=2000")
    ax1.set_xscale("log")
    ax1.set_yscale("log")
    ax1.set_xlabel("string length n")
    ax1.set_ylabel("cells stored (log scale)")
    ax1.set_title("Space: quadratic vs linear", loc="left", fontsize=11)
    ax1.legend(loc="upper center", bbox_to_anchor=(0.5, -0.16), fontsize=8,
               ncol=1, handlelength=2.2)
    ax1.set_ylim(50, 5e7)

    # The cliff: measured, not modelled. OOM is drawn as a cross above the cap,
    # not as a bar: a bar would imply "used 16 MiB", when the truth is "died".
    lengths = [800, 1200, 1500, 2000, 5000, 20000, 50000]
    upstream = {800: 4.76, 1200: 10.76}
    shipped = {1500: 0.04, 2000: 0.05, 5000: 0.15, 20000: 0.37, 50000: 0.89}
    oom = [1500, 2000, 5000, 20000, 50000]

    for i, n in enumerate(lengths):
        if n in upstream:
            ax2.bar(i - 0.19, upstream[n], width=0.36, color=TERRACOTTA,
                    label="upstream (full matrix)" if n == 800 else None)
        if n in shipped:
            ax2.bar(i + 0.19, max(shipped[n], 0.03), width=0.36, color=OLIVE,
                    label="shipped (two rows)" if n == 1500 else None)

    for i, n in enumerate(lengths):
        if n in oom:
            ax2.plot([i - 0.19], [12.2], marker="x", markersize=9, markeredgewidth=2.2,
                     color=TERRACOTTA, linestyle="none")

    ax2.plot([], [], marker="x", markersize=9, markeredgewidth=2.2, color=TERRACOTTA,
             linestyle="none", label="upstream: OOM (killed)")

    ax2.axhline(16, color=INK, linewidth=1.0, linestyle="--")
    ax2.text(4.05, 16.5, "16 MiB heap cap", fontsize=8.5, color=INK)

    ax2.set_xticks(range(len(lengths)))
    ax2.set_xticklabels([str(n) for n in lengths], rotation=30, ha="right")
    ax2.set_xlabel("string length n (equal length)")
    ax2.set_ylabel("measured heap delta (MiB)")
    ax2.set_ylim(0, 30)
    ax2.set_yticks([0, 5, 10, 15, 20])
    ax2.set_title("Measured: where upstream dies", loc="left", fontsize=11)
    ax2.legend(loc="upper center", bbox_to_anchor=(0.52, 1.0), fontsize=8, ncol=1,
               handlelength=1.8, borderaxespad=0.4)

    fig.suptitle(
        "Levenshtein: memory is the real win, and it is a cliff not a slope",
        x=0.008, ha="left", fontsize=12.5, color=INK,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(OUT / "memory.png", dpi=180)
    plt.close(fig)


def fig_asymmetric() -> None:
    """What the argument swap actually buys: memory, not time.

    This is the most useful figure in the repo, because it contradicts the
    obvious expectation. Arms C and D compute the SAME number of cells for any
    input -- (n+1)(m+1) is symmetric -- so the swap cannot reduce work. It only
    changes row width and the outer loop count, and those pull opposite ways:

      * short string passed second: C already has narrow rows. The swap only
        adds work, and it is measurably SLOWER.
      * short string passed first: C has wide rows, the swap narrows them, but
        it also multiplies the outer loop count. At 256/2000 that trade loses
        badly; at 64/2000 it roughly breaks even.

    The bottom panel is the point: whatever the speed story is, the memory
    story is unambiguous, and memory is why the change is worth shipping.

    Data comes from benchmarks/swap-probe.json (31 interleaved rounds per
    shape), not from the headline benchmark, whose 11 rounds are too few to
    resolve a 10-20% effect on asymmetric inputs.
    """
    recs = SWAP["records"]

    # Pair up the two orientations per shape, in shape order.
    shapes = []
    for rec in recs:
        key = (rec["short"], rec["long"])
        if key not in [s[0] for s in shapes]:
            shapes.append((key, {}))

    for rec in recs:
        key = (rec["short"], rec["long"])
        for s in shapes:
            if s[0] == key:
                s[1][rec["orientation"]] = rec

    labels = [f"{k[0]}/{k[1]}" for k, _ in shapes]
    x = range(len(shapes))
    width = 0.36

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(9.6, 7.8),
                                   gridspec_kw={"height_ratios": [1.15, 1]})

    # --- top: speed, both orientations ---
    sf = [d["shortFirst"]["ratio"] for _, d in shapes]
    lf = [d["longFirst"]["ratio"] for _, d in shapes]
    sf_err = [
        [d["shortFirst"]["ratio"] - d["shortFirst"]["p10"] for _, d in shapes],
        [d["shortFirst"]["p90"] - d["shortFirst"]["ratio"] for _, d in shapes],
    ]
    lf_err = [
        [d["longFirst"]["ratio"] - d["longFirst"]["p10"] for _, d in shapes],
        [d["longFirst"]["p90"] - d["longFirst"]["ratio"] for _, d in shapes],
    ]

    ax1.bar([i - width / 2 for i in x], sf, width=width, color=AMBER,
            label="short string passed FIRST (C pays full row width)")
    ax1.bar([i + width / 2 for i in x], lf, width=width, color=TERRACOTTA,
            label="short string passed SECOND (C already narrow)")
    ax1.errorbar([i - width / 2 for i in x], sf, yerr=sf_err, fmt="none",
                 ecolor=INK, elinewidth=0.9, capsize=3)
    ax1.errorbar([i + width / 2 for i in x], lf, yerr=lf_err, fmt="none",
                 ecolor=INK, elinewidth=0.9, capsize=3)

    ax1.axhline(1.0, color=INK, linewidth=1.0)
    ax1.set_xticks(list(x))
    ax1.set_xticklabels(labels)
    ax1.set_xlabel("input shape (short length / long length)")
    ax1.set_ylabel("C / D ratio  (>1 means swap wins)")
    ax1.set_ylim(0.6, 1.35)
    ax1.set_title(
        "Speed: the swap is often a LOSS, and never a big win  (bars = median, whiskers = p10-p90)",
        loc="left", fontsize=10.5,
    )
    ax1.legend(loc="upper center", bbox_to_anchor=(0.5, -0.14), fontsize=8.5, ncol=2,
               handlelength=1.6)

    for i, (v, d) in enumerate(zip(sf, [d for _, d in shapes])):
        mark = d["shortFirst"]["verdict"]
        ax1.text(i - width / 2, v + 0.02, mark.replace("D ", ""), ha="center",
                 va="bottom", fontsize=7.5, color=INK)

    # --- bottom: memory, unambiguous ---
    mem = {m["short"]: m for m in SWAP["memory"]}
    ratios = [mem[k[0]]["ratio"] for k, _ in shapes]

    bars = ax2.bar(list(x), ratios, width=0.6, color=OLIVE)
    ax2.set_yscale("log")
    ax2.set_ylim(1e-3, 2)
    ax2.axhline(1.0, color=INK, linewidth=1.0, linestyle="--")
    ax2.set_xticks(list(x))
    ax2.set_xticklabels(labels)
    ax2.set_xlabel("input shape (short length / long length)")
    ax2.set_ylabel("cells held by D / cells held by C  (log)")
    ax2.set_title(
        "Memory: the swap is always a win, by up to 222x at 8 vs 2000  -  this is the reason to ship it",
        loc="left", fontsize=10.5,
    )

    for rect, v in zip(bars, ratios):
        ax2.text(rect.get_x() + rect.get_width() / 2, v * 1.35, f"{v:.3f}",
                 ha="center", va="bottom", fontsize=8.5, color=INK)

    fig.suptitle(
        "The argument swap trades a little speed for a lot of memory",
        x=0.008, ha="left", fontsize=13, color=INK,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(OUT / "asymmetric.png", dpi=180)
    plt.close(fig)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fig_four_arms()
    fig_memory()
    fig_asymmetric()
    for name in ("four-arms.png", "memory.png", "asymmetric.png"):
        print(f"wrote assets/{name}")


if __name__ == "__main__":
    main()
