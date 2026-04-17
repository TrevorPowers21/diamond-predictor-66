/**
 * RSTR IQ — Scouting Report Generator
 *
 * Produces automated scouting prose for hitters and pitchers based on
 * the evaluation framework developed with the coaching staff.
 *
 * Two output variants:
 *   - Savant (numeric): includes percentages, percentiles, exact values
 *   - RSTR IQ (qualitative): uses grade words only (elite, plus, above-average, etc.)
 *
 * Two output lengths:
 *   - SHORT: 3-5 sentences, on-page display
 *   - FULL: 4-6 paragraphs, PDF export
 */

// ── Grade helpers ──────────────────────────────────────────────────

type Tier = "elite" | "plus" | "above-average" | "average" | "slightly above-average" | "slightly below-average" | "below-average" | "well below-average";

function pctToTier(pct: number): Tier {
  if (pct >= 90) return "elite";
  if (pct >= 75) return "plus";
  if (pct >= 60) return "above-average";
  if (pct >= 55) return "slightly above-average";
  if (pct >= 45) return "average";
  if (pct >= 40) return "slightly below-average";
  if (pct >= 25) return "below-average";
  return "well below-average";
}

/** Format a percentage value for Savant reports */
const fmtPct = (v: number | null) => v != null ? `${v.toFixed(1)}%` : null;
const fmtDec = (v: number | null, d = 3) => v != null ? v.toFixed(d) : null;
const fmtInt = (v: number | null) => v != null ? `${Math.round(v)}` : null;

// ── Shared input types ─────────────────────────────────────────────

export interface HitterScoutingInput {
  // Identity
  batHand?: string | null;
  position?: string | null;
  conference?: string | null;

  // Production (outcome)
  avg?: number | null;
  obp?: number | null;
  slg?: number | null;
  ops?: number | null;
  iso?: number | null;
  wrcPlus?: number | null;
  pa?: number | null;

  // Data (process)
  contact?: number | null;
  chase?: number | null;
  bb?: number | null;
  avgEv?: number | null;
  ev90?: number | null;
  barrel?: number | null;
  laSweet?: number | null;
  lineDrive?: number | null;
  gb?: number | null;
  pull?: number | null;
  popUp?: number | null;

  // Percentiles (for Savant variant)
  pct?: {
    avg?: number | null;
    obp?: number | null;
    slg?: number | null;
    ops?: number | null;
    iso?: number | null;
    wrcPlus?: number | null;
    contact?: number | null;
    chase?: number | null;
    bb?: number | null;
    avgEv?: number | null;
    ev90?: number | null;
    barrel?: number | null;
    laSweet?: number | null;
    lineDrive?: number | null;
    gb?: number | null;
    pull?: number | null;
  };

  // YoY comparison (prior season)
  prior?: {
    contact?: number | null;
    chase?: number | null;
    avgEv?: number | null;
    ev90?: number | null;
    barrel?: number | null;
    laSweet?: number | null;
    lineDrive?: number | null;
    bb?: number | null;
    avg?: number | null;
  };

  // Projection
  projectedWrcPlus?: number | null;
}

export interface PitcherScoutingInput {
  // Identity
  throwHand?: string | null;
  role?: string | null; // "Starter" | "Reliever" | "Closer" etc
  conference?: string | null;

  // Traditional
  era?: number | null;
  fip?: number | null;
  whip?: number | null;
  k9?: number | null;
  bb9?: number | null;
  hr9?: number | null;
  ip?: number | null;

  // Data
  stuffPlus?: number | null;
  whiffPct?: number | null;
  izWhiffPct?: number | null;
  chasePct?: number | null;
  bbPct?: number | null;
  hardHitPct?: number | null;
  barrelPct?: number | null;
  exitVel?: number | null;
  gbPct?: number | null;
  vel90th?: number | null;

  // Pitch arsenal
  pitches?: Array<{
    name: string;
    count?: number | null;
    velocity?: number | null;
    ivb?: number | null;
    hb?: number | null;
    whiffPct?: number | null;
    stuffPlus?: number | null;
    relHeight?: number | null;
    extension?: number | null;
    vaa?: number | null;
  }>;

  // Percentiles
  pct?: {
    era?: number | null;
    fip?: number | null;
    whip?: number | null;
    k9?: number | null;
    bb9?: number | null;
    hr9?: number | null;
    stuffPlus?: number | null;
    whiffPct?: number | null;
    izWhiffPct?: number | null;
    chasePct?: number | null;
    bbPct?: number | null;
    hardHitPct?: number | null;
    barrelPct?: number | null;
    exitVel?: number | null;
    gbPct?: number | null;
  };

  // YoY comparison
  prior?: {
    whiffPct?: number | null;
    izWhiffPct?: number | null;
    chasePct?: number | null;
    bbPct?: number | null;
    hardHitPct?: number | null;
    barrelPct?: number | null;
    exitVel?: number | null;
    gbPct?: number | null;
    era?: number | null;
  };

  // Projection
  projectedPrvPlus?: number | null;
}

export type ReportVariant = "savant" | "rstriq";
export type ReportLength = "short" | "full";

// ── Hitter report generator ───────────────────────────────────────

export function generateHitterReport(
  input: HitterScoutingInput,
  variant: ReportVariant,
  length: ReportLength,
): string {
  const s = variant === "savant"; // numeric mode
  const p = input.pct || {};
  const paragraphs: string[] = [];

  // ── Detect archetype ──
  const hand = input.batHand === "L" ? "Left-handed" : input.batHand === "R" ? "Right-handed" : "";
  const pos = input.position || "hitter";
  const premiumPos = ["C", "SS", "CF"].some((pp) => (pos || "").toUpperCase().includes(pp));

  const hasEliteChase = (input.chase != null && input.chase < 19) || (p.chase != null && p.chase >= 90);
  const hasGoodChase = (input.chase != null && input.chase < 22) || (p.chase != null && p.chase >= 75);
  const hasBadChase = (input.chase != null && input.chase > 28) || (p.chase != null && p.chase <= 20);
  const hasUltraAggressiveChase = (input.chase != null && input.chase > 32) || (p.chase != null && p.chase <= 10);

  const hasBadContact = input.contact != null && input.contact < 70;
  const hasVeryBadContact = input.contact != null && input.contact < 66.7;
  const hasGoodContact = input.contact != null && input.contact > 80;
  const hasEliteContact = input.contact != null && input.contact > 85;

  const hasEliteEv = (input.avgEv != null && input.avgEv > 92) || (p.avgEv != null && p.avgEv >= 90);
  const hasPlusEv = (input.avgEv != null && input.avgEv > 89) || (p.avgEv != null && p.avgEv >= 75);
  const hasEliteEv90 = (input.ev90 != null && input.ev90 > 106) || (p.ev90 != null && p.ev90 >= 90);

  const hasPlusBarrel = (p.barrel != null && p.barrel >= 75) || (input.barrel != null && input.barrel > 18);
  const hasEliteBarrel = (p.barrel != null && p.barrel >= 90) || (input.barrel != null && input.barrel > 25);
  const hasLowLaSweet = p.laSweet != null && p.laSweet < 40;

  const fearedProfile = hasBadContact && hasBadChase;
  const completeProfile = hasGoodContact && hasGoodChase && hasPlusEv && hasPlusBarrel;
  const powerFirst = hasPlusEv && hasPlusBarrel && !hasGoodContact;
  const contactFirst = hasGoodContact && !hasPlusEv && !hasPlusBarrel;

  // ── Paragraph 1: Opener + primary strengths ──
  let opener = `${hand} hitting ${pos.toLowerCase()}`;

  if (fearedProfile) {
    if (hasEliteEv || hasEliteEv90) {
      opener += " with elite raw power and an ultra-aggressive approach";
    } else {
      opener += " with significant approach and contact concerns";
    }
  } else if (completeProfile) {
    const approachWord = hasEliteChase ? "elite approach" : "plus approach";
    opener += ` with an ${approachWord}, plus contact, and plus power — a complete, well-rounded offensive profile`;
    if (premiumPos) opener += " at a premium defensive position";
  } else if (powerFirst && hasUltraAggressiveChase) {
    opener += " with an ultra-aggressive approach";
  } else if (powerFirst) {
    opener += " with a strong feel for power";
    if (hasBadContact) opener += ", paired with contact concerns that raise the variance";
  } else if (contactFirst) {
    if (hasEliteContact && hasEliteChase) {
      opener += " with elite contact abilities and elite swing decisions";
    } else if (hasGoodContact && hasGoodChase) {
      opener += " with plus contact and plus swing decisions";
    } else {
      opener += " with a contact-oriented profile";
    }
  } else {
    opener += " with a solid overall offensive profile";
  }
  opener += ".";

  // Power detail
  const powerParts: string[] = [];
  if (input.avgEv != null && hasPlusEv) {
    const evTier = s ? `${input.avgEv.toFixed(1)} mph average exit velocity${p.avgEv ? ` at the ${p.avgEv}th percentile` : ""}` : `${pctToTier(p.avgEv || 50)} average exit velocity`;
    powerParts.push(evTier);
  }
  if (input.ev90 != null && hasEliteEv90) {
    const ev90Tier = s ? `${input.ev90.toFixed(1)} EV90${p.ev90 ? ` at the ${p.ev90}th` : ""}` : `${pctToTier(p.ev90 || 50)} EV90`;
    powerParts.push(ev90Tier);
  }
  if (input.barrel != null && hasPlusBarrel) {
    const brlTier = s ? `${input.barrel.toFixed(1)}% barrel rate` : `${pctToTier(p.barrel || 50)} barrel rate`;
    powerParts.push(brlTier);
  }

  if (powerParts.length > 0) {
    const powerQual = hasEliteEv ? "are all elite" : hasPlusEv ? "are all plus" : "are all above average";
    if (s) {
      opener += ` A ${powerParts.join(", and ")} ${powerParts.length > 1 ? powerQual : ""}.`;
    } else {
      opener += ` ${powerParts.join(", and ")}.`;
    }
  }

  // Pull + barrel feel
  if (input.pull != null && input.pull > 45 && hasPlusBarrel) {
    if (s) {
      opener += ` He has a feel for pulling the ball in the air — ${input.barrel?.toFixed(1)}% barrel and ${input.pull?.toFixed(1)}% pull.`;
    } else {
      opener += " He has a feel for pulling the ball in the air.";
    }
  }

  // Barrel vs LA sweet spot divergence
  if (hasPlusBarrel && hasLowLaSweet) {
    opener += s
      ? ` He has an above-average ability for impacting the baseball with a ${input.barrel?.toFixed(1)}% barrel rate, but there are still inconsistencies with a ${p.laSweet ? `${p.laSweet}th percentile` : "below-average"} launch angle sweet spot.`
      : " He has an above-average ability for impacting the baseball, but there are still inconsistencies with a below-average launch angle sweet spot.";
  }

  paragraphs.push(opener.replace(/\.\./g, ".").trim());

  // ── Paragraph 2: Approach + discipline ──
  if (length === "full" || fearedProfile || hasUltraAggressiveChase || hasBadContact) {
    const approachParts: string[] = [];

    if (fearedProfile) {
      if (s) {
        approachParts.push(`The risk in the profile is significant. The ${input.contact?.toFixed(1)}% contact rate${p.contact ? ` at the ${p.contact}th percentile` : ""} and ${input.chase?.toFixed(1)}% chase rate${p.chase ? ` at the ${p.chase}th percentile` : ""} mean both safety valves are gone — he doesn't make contact consistently and the swing decisions are ultra-aggressive.`);
      } else {
        approachParts.push("The risk in the profile is significant. Below-average contact rates with an ultra-aggressive approach mean both safety valves are gone.");
      }
      approachParts.push("An over-aggressive approach with below-average contact can be exposed by a smart pitcher or high-level pitching.");

      if (input.bb != null && input.obp != null && s) {
        approachParts.push(`The ${input.bb.toFixed(1)}% walk rate${p.bb ? ` at the ${p.bb}th percentile` : ""} and ${input.obp.toFixed(3)} OBP${p.obp ? ` at the ${p.obp}th percentile` : ""} show the approach concerns bleeding into the on-field production.`);
      }
    } else if (hasUltraAggressiveChase) {
      if (s) {
        approachParts.push(`The ${input.chase?.toFixed(1)}% chase rate${p.chase ? ` (${p.chase}th percentile)` : ""} is the core concern. Could be exposed by high-level pitching that throws competitive pitches out of the zone.`);
        if (input.contact != null) {
          const contactLabel = hasGoodContact ? "plus" : hasBadContact ? "below average" : "slightly above average";
          approachParts.push(`The ${input.bb?.toFixed(1)}% walk rate is ${pctToTier(p.bb || 50)} and the ${input.contact?.toFixed(1)}% contact rate is ${contactLabel}.`);
        }
      } else {
        approachParts.push("The chase rate is the core concern. Could be exposed by high-level pitching that throws competitive pitches out of the zone.");
      }
    } else if (hasBadContact && hasGoodChase) {
      if (s) {
        approachParts.push(`The approach is ${hasEliteChase ? "elite" : "plus"} — ${input.chase?.toFixed(1)}% chase and ${input.bb?.toFixed(1)}% BB, both in the ${hasEliteChase ? "top" : "upper"} percentile. That chase rate raises his floor meaningfully.`);
      } else {
        approachParts.push(`The approach is ${hasEliteChase ? "elite" : "plus"} — he doesn't chase and takes his walks. That raises his floor meaningfully.`);
      }
      approachParts.push(s
        ? `The ${input.contact?.toFixed(1)}% contact rate reinforces the concern; the batting average will always hinge on whether the bat finds the ball.`
        : "The contact rate reinforces the concern; the batting average will always hinge on whether the bat finds the ball.");
    } else if (hasEliteChase && hasEliteContact) {
      if (s) {
        approachParts.push(`The approach is elite — ${input.chase?.toFixed(1)}% chase and ${input.bb?.toFixed(1)}% BB, both in the top percentile.`);
      } else {
        approachParts.push("The approach is elite — he doesn't chase and takes his walks.");
      }
    }

    if (approachParts.length > 0) paragraphs.push(approachParts.join(" "));
  }

  // ── Paragraph 3: Production vs data disconnect (if applicable) ──
  if (length === "full" && input.avg != null && input.obp != null && input.slg != null) {
    const allProcessElite = hasPlusEv && hasPlusBarrel && (hasGoodContact || hasGoodChase);
    const productionStrong = p.avg != null && p.avg >= 85 && p.obp != null && p.obp >= 85 && p.slg != null && p.slg >= 85;
    const allProcessSuperElite = hasEliteEv && hasEliteBarrel && hasEliteContact;

    // Data >> Production — flag upside
    if (allProcessSuperElite && productionStrong && !allProcessSuperElite) {
      // Production is strong but data says even more
      const line = s
        ? `The ${input.avg.toFixed(3)}/${input.obp.toFixed(3)}/${input.slg.toFixed(3)} line is elite production. What's worth noting is that the underlying data points to even more upside than the stat line reflects.`
        : "The on-field production is elite. What's worth noting is that the underlying data points to even more upside than the stat line reflects.";
      paragraphs.push(line);
    }

    // EV-dependent production for feared profiles
    if (fearedProfile && hasEliteEv) {
      const line = s
        ? `The ${input.avg?.toFixed(3)} batting average is solid, but the combination of high exit velocity with really bad contact rates and bad chase rates is a bad mixture year over year.`
        : "The batting average is solid, but the combination of high exit velocity with really bad contact rates and bad chase rates is a bad mixture year over year.";

      const posNote = (pos || "").toUpperCase().includes("1B") || (pos || "").toUpperCase().includes("FIRST")
        ? " As a first base prospect, there is little to no value outside of the bat, so the bat has to carry everything."
        : premiumPos
          ? ` At a premium defensive position, the approach concerns are more forgivable.`
          : "";

      paragraphs.push(line + posNote);
    }
  }

  // ── Paragraph 4: YoY trajectory (only when concerning) ──
  if (length === "full" && input.prior) {
    const pr = input.prior;
    const yoyParts: string[] = [];

    if (pr.contact != null && input.contact != null) {
      const delta = input.contact - pr.contact;
      if (Math.abs(delta) < 1) {
        yoyParts.push(`contact stayed flat at ${pr.contact.toFixed(1)}% → ${input.contact.toFixed(1)}%`);
      } else if (delta < -1) {
        yoyParts.push(`contact dropped from ${pr.contact.toFixed(1)}% to ${input.contact.toFixed(1)}%`);
      }
    }

    if (pr.avg != null && input.avg != null) {
      const avgDelta = Math.round((input.avg - pr.avg) * 1000);
      if (Math.abs(avgDelta) > 80) {
        yoyParts.push(`a ${Math.abs(avgDelta)}-point ${avgDelta > 0 ? "jump" : "drop"} in batting average raises progression-versus-hot-stretch questions`);
      }
    }

    // Only include trajectory if there's something to flag
    if (yoyParts.length > 0 && s) {
      paragraphs.push("Year over year, " + yoyParts.join(" and ") + ".");
    } else if (yoyParts.length > 0) {
      paragraphs.push("Year over year, the underlying metrics " + (yoyParts.some(p => p.includes("drop")) ? "show some regression." : "aren't trending meaningfully."));
    }
  }

  // ── Closer: projection ──
  const closerParts: string[] = [];

  // Ceiling / floor based on archetype
  if (fearedProfile) {
    if (hasEliteEv || hasEliteEv90) {
      closerParts.push("All-Conference caliber ceiling. Role player floor. Anywhere in between could be realistic expectations.");
    } else {
      closerParts.push("Role player ceiling with significant downside risk.");
    }
  } else if (completeProfile) {
    closerParts.push("All-American-caliber profile.");
    if (hasPlusEv && !hasEliteEv) {
      closerParts.push(s
        ? `If the average exit velocity and EV90 tick up, he profiles as one of the best players in the country.`
        : "If the exit velocity ticks up, the ceiling goes even higher.");
    }
  } else if (powerFirst && hasBadContact) {
    if (premiumPos) {
      closerParts.push(`The ceiling is one of the best ${pos.toLowerCase()}s in the country. The ${hasEliteChase ? "elite chase keeps the OBP high, and the" : ""} premium defensive position forgives the hit-tool concerns in a way no other spot on the field does. All-American caliber starter.`);
    } else {
      closerParts.push("All-Conference caliber ceiling with a lower floor tied to the contact.");
    }
  } else if (contactFirst) {
    closerParts.push("Safer floor on the skillset side, capped ceiling on the tools. Role player projection unless the raw power develops.");
  } else {
    closerParts.push("Solid overall prospect with starter upside.");
  }

  paragraphs.push(closerParts.join(" "));

  return paragraphs.join("\n\n");
}

// ── Pitcher report generator ──────────────────────────────────────

export function generatePitcherReport(
  input: PitcherScoutingInput,
  variant: ReportVariant,
  length: ReportLength,
): string {
  const s = variant === "savant";
  const p = input.pct || {};
  const paragraphs: string[] = [];

  // ── Detect archetype ──
  const hand = input.throwHand === "L" ? "left-handed" : input.throwHand === "R" ? "right-handed" : "";
  const role = (input.role || "").toLowerCase().includes("start") ? "starter" : "reliever";

  const hasEliteStuff = input.stuffPlus != null && input.stuffPlus >= 108;
  const hasPlusStuff = input.stuffPlus != null && input.stuffPlus >= 103;
  const hasAvgStuff = input.stuffPlus != null && input.stuffPlus >= 98 && input.stuffPlus < 103;
  const hasBelowStuff = input.stuffPlus != null && input.stuffPlus < 98;

  const hasEliteCommand = (input.bbPct != null && input.bbPct < 5.5) || (p.bbPct != null && p.bbPct >= 90);
  const hasPlusCommand = (input.bbPct != null && input.bbPct < 7) || (p.bbPct != null && p.bbPct >= 75);
  const hasBelowCommand = (input.bbPct != null && input.bbPct > 10) || (p.bbPct != null && p.bbPct < 40);

  const hasEliteWhiff = (input.whiffPct != null && input.whiffPct >= 30) || (p.whiffPct != null && p.whiffPct >= 90);
  const hasLowWhiff = (input.whiffPct != null && input.whiffPct < 20) || (p.whiffPct != null && p.whiffPct < 40);
  const hasLowIzWhiff = (p.izWhiffPct != null && p.izWhiffPct < 45);
  const hasEliteIzWhiff = (p.izWhiffPct != null && p.izWhiffPct >= 90);

  const hasHighChase = (input.chasePct != null && input.chasePct > 30) || (p.chasePct != null && p.chasePct >= 90);
  const hasEliteGB = (input.gbPct != null && input.gbPct > 50) || (p.gbPct != null && p.gbPct >= 85);
  const hasHighHardHit = (p.hardHitPct != null && p.hardHitPct < 30);
  const hasHighBarrel = input.barrelPct != null && input.barrelPct > 12;
  const hasHighHR = (p.hr9 != null && p.hr9 < 25);

  // Chase-dependent: high chase driving good numbers but low IZ whiff
  const chaseDependentProfile = hasHighChase && hasLowIzWhiff && hasLowWhiff;
  // Sinker profile: high GB, command-first
  const sinkerProfile = hasEliteGB && hasPlusCommand;
  // Stuff-over-command: elite stuff but walks guys
  const stuffOverCommand = hasEliteStuff && hasBelowCommand;

  // Detect primary fastball type
  const pitches = input.pitches || [];
  const sinker = pitches.find((pp) => pp.name.toLowerCase().includes("sink"));
  const fourSeam = pitches.find((pp) => pp.name.includes("4S") || pp.name.toLowerCase().includes("four"));
  const isSinkerFirst = sinker && fourSeam && (sinker.count || 0) > (fourSeam.count || 0) * 1.5;
  const isSinkerDominant = sinker && (!fourSeam || (sinker.count || 0) > (fourSeam.count || 0) * 2);

  // ── Paragraph 1: Opener ──
  let opener = "";

  if (isSinkerDominant || isSinkerFirst) {
    opener = `Elite sinkerballing ${hand} pitcher that relies on a combination of above-average whiff and an elite ground ball rate.`;
  } else if (hasEliteStuff && hasEliteWhiff) {
    const veloDesc = fourSeam && fourSeam.velocity != null && fourSeam.velocity >= 95 ? "high-octane" : (sinker && sinker.velocity != null && sinker.velocity >= 95 ? "high-octane" : "");
    opener = `${veloDesc ? veloDesc.charAt(0).toUpperCase() + veloDesc.slice(1) + " stuff from a" : "Power"} ${hand} arm generating elite swing-and-miss`;
  } else if (chaseDependentProfile) {
    opener = `${hand.charAt(0).toUpperCase() + hand.slice(1)} ${role} with above-average stuff and elite strike-throwing ability, but a profile that carries real variance underneath the surface numbers`;
  } else if (hasAvgStuff && hasEliteCommand) {
    opener = `${hand.charAt(0).toUpperCase() + hand.slice(1)} ${role} with average stuff and elite command — a reliable innings eater that survives on limiting damage`;
  } else {
    opener = `${hand.charAt(0).toUpperCase() + hand.slice(1)} ${role} with ${pctToTier(p.stuffPlus || 50)} stuff`;
  }

  // Stuff+ detail
  if (input.stuffPlus != null && s) {
    opener += ` — a ${Math.round(input.stuffPlus)} Stuff+${p.stuffPlus ? ` at the ${p.stuffPlus}th percentile` : ""}`;
    if (input.whiffPct != null && hasEliteWhiff) {
      opener += `, ${input.whiffPct.toFixed(1)}% whiff${p.whiffPct ? ` at the ${p.whiffPct}th` : ""}`;
    }
    if (input.izWhiffPct != null && hasEliteIzWhiff) {
      opener += `, and ${input.izWhiffPct.toFixed(1)}% in-zone whiff${p.izWhiffPct ? ` at the ${p.izWhiffPct}th` : ""}`;
    }
  }
  opener += ".";

  // Fastball detail for full reports
  if (length === "full" && (fourSeam || sinker)) {
    const fb = isSinkerDominant ? sinker : fourSeam;
    if (fb && fb.velocity != null) {
      const veloRange = fb.velocity >= 95 ? "upper 90s" : fb.velocity >= 93 ? "mid 90s" : fb.velocity >= 90 ? "low 90s" : "upper 80s";
      opener += ` The ${fb.name.toLowerCase()} sits in the ${veloRange}, averaging ${fb.velocity.toFixed(1)}`;

      if (fb.vaa != null) {
        opener += ` with a ${fb.vaa.toFixed(1)} VAA`;
      }
      if (fb.ivb != null) {
        opener += `. ${fb.ivb > 12 ? "Above-average" : fb.ivb > 9 ? "Average" : "Above-average"} IVB${fb.extension != null ? " and extension" : ""}${fb.relHeight != null ? ` with ${fb.relHeight > 5.8 ? "an above-average" : "an average"} release height` : ""} allow him to attack the ${fb.ivb > 10 ? "top of the zone" : "zone"} effectively`;
      }
      opener += ".";
    }
  }

  // Command
  if (hasEliteCommand) {
    opener += s
      ? ` Elite command with a ${input.bbPct?.toFixed(1)}% walk rate${p.bbPct ? ` at the ${p.bbPct}th percentile` : ""}${input.bb9 != null ? ` and a ${input.bb9.toFixed(2)} BB/9${p.bb9 ? ` at the ${p.bb9}th` : ""}` : ""}.`
      : " Elite command.";
  } else if (hasPlusCommand) {
    opener += s
      ? ` Plus command with a ${input.bbPct?.toFixed(1)}% walk rate${p.bbPct ? ` at the ${p.bbPct}th percentile` : ""}.`
      : " Plus command.";
  }

  paragraphs.push(opener.replace(/\.\./g, ".").replace(/\s+/g, " ").trim());

  // ── Paragraph 2: Pitch profile + contact quality ──
  if (length === "full") {
    const profileParts: string[] = [];

    // Hard hit / GB context
    if (hasHighHardHit && hasEliteWhiff) {
      // 4S FB profile — hard hit expected
      if (isSinkerDominant) {
        profileParts.push("There are some hard contact concerns, but with an elite ground ball rate he can get away with that.");
      } else {
        profileParts.push(s
          ? `With a four-seam fastball with above-average IVB, there is some hard contact and specifically in the air, which drives the ground ball rate down${p.gbPct ? ` to the ${p.gbPct}th percentile` : ""}. The swing-and-miss makes up for the occasional barreled baseball that goes for a home run${input.hr9 != null ? `, as shown by the ${input.hr9.toFixed(2)} HR/9` : ""}.`
          : "With a four-seam profile, there is some hard contact in the air, but the swing-and-miss makes up for the occasional barrel.");
      }
    } else if (hasHighHardHit && !hasEliteWhiff) {
      // Hard hit without whiff = real concern
      profileParts.push(s
        ? `The hard hit rate at ${input.hardHitPct?.toFixed(1)}%${p.hardHitPct ? `, ${p.hardHitPct}th percentile,` : ""} and ${input.hr9 != null ? `a ${p.hr9 ? `${p.hr9}th percentile` : ""} home run per nine at ${input.hr9.toFixed(2)}` : "the damage profile"} tell the same story — when he gets hit, it's typically hit hard and leads to a lot of home runs.`
        : "When he gets hit, it's typically hit hard and leads to a lot of home runs.");
    } else if (hasEliteGB) {
      profileParts.push(s
        ? `The ${input.gbPct?.toFixed(1)}% ground ball rate${p.gbPct ? ` at the ${p.gbPct}th percentile` : ""} is elite and translates across every level.`
        : "The ground ball rate is elite and translates across every level.");
    }

    // Secondary pitches
    const secondaries = pitches.filter((pp) =>
      !pp.name.toLowerCase().includes("sink") && !pp.name.includes("4S") && !pp.name.toLowerCase().includes("four")
    ).filter((pp) => (pp.count || 0) >= 20);

    if (secondaries.length > 0) {
      const bestSecondary = secondaries.reduce((a, b) => ((a.whiffPct || 0) > (b.whiffPct || 0) ? a : b));
      const secondaryDescs = secondaries.map((pp) => {
        const grade = pp.stuffPlus != null ? (pp.stuffPlus >= 106 ? "solid" : pp.stuffPlus >= 103 ? "solid" : "average") : "";
        return `${pp.name}${grade ? ` grades out as ${grade}` : ""}${pp.stuffPlus != null ? ` at ${Math.round(pp.stuffPlus)} Stuff+` : ""}${pp.whiffPct != null && pp.whiffPct > 35 ? ` with a ${pp.whiffPct.toFixed(1)}% whiff rate` : ""}`;
      });

      if (secondaryDescs.length > 0 && s) {
        profileParts.push(`The ${secondaryDescs.join(". The ")}.`);
        if (bestSecondary.whiffPct != null && bestSecondary.whiffPct > 40) {
          profileParts.push(`The ${bestSecondary.name.toLowerCase()} is a huge asset with a ${bestSecondary.whiffPct.toFixed(1)}% whiff rate.`);
        }
      }
    }

    // Pitch count / mix concern
    const meaningfulPitches = pitches.filter((pp) => (pp.count || 0) >= 40);
    if (meaningfulPitches.length <= 2 && hasEliteStuff) {
      profileParts.push("There is always going to be risk with a two-pitch pitcher, even with stuff this elite. Limited pitch mix leads to more inconsistencies.");
    }

    if (profileParts.length > 0) paragraphs.push(profileParts.join(" "));
  }

  // ── Paragraph 3: Chase-dependent concern ──
  if (chaseDependentProfile) {
    const chasePara = s
      ? `The concern is how the profile is built. The ${input.chasePct?.toFixed(1)}% chase rate${p.chasePct ? ` at the ${p.chasePct}th percentile` : ""} is driving a lot of the good numbers — the ${input.bbPct?.toFixed(1)}% walk rate${p.bbPct ? ` at the ${p.bbPct}th percentile` : ""} and the ${input.k9?.toFixed(2)} K/9 are both propped up by hitters chasing pitches out of the zone. The in-zone whiff at ${input.izWhiffPct?.toFixed(1)}% sits${p.izWhiffPct ? ` at the ${p.izWhiffPct}th percentile` : ""} and the overall whiff at ${input.whiffPct?.toFixed(1)}% is${p.whiffPct ? ` at the ${p.whiffPct}th` : ""}. The swing-and-miss isn't there in the zone. Year over year, if hitters start laying off, the walk rate, strikeout rate, and ERA all move in the wrong direction together.`
      : "The concern is how the profile is built. The chase rate is driving a lot of the good numbers — the walk rate and K/9 are propped up by hitters chasing. The swing-and-miss isn't there in the zone. Year over year, if hitters start laying off, those numbers all move in the wrong direction together.";
    paragraphs.push(chasePara);
  }

  // ── Paragraph 3 alt: Chase as stuff showcase (sinker/command profiles) ──
  if (hasHighChase && !chaseDependentProfile && hasPlusCommand) {
    const chasePara = s
      ? `The chase rate${p.chasePct ? ` at the ${p.chasePct}th percentile` : ""} is high, but that is a showcase of his quality of stuff more than a masking concern — shown by the ${Math.round(input.stuffPlus || 0)} overall Stuff+ and the command to back it up.`
      : "The chase rate is high, but that is a showcase of his quality of stuff more than a masking concern — the command backs it up.";
    paragraphs.push(chasePara);
  }

  // ── Paragraph 4: Stuff-over-command variance ──
  if (stuffOverCommand && length === "full") {
    const varPara = s
      ? `There is some variance in the profile. The ${input.bbPct?.toFixed(1)}% walk rate${p.bbPct ? ` at the ${p.bbPct}th percentile` : ""} is ${pctToTier(p.bbPct || 50)} but is masked by a ${input.chasePct?.toFixed(1)}% chase rate, which makes the command picture prone to inconsistencies.`
      : "There is some variance in the profile. The walk rate is masked by the chase rate, which makes the command picture prone to inconsistencies.";
    paragraphs.push(varPara);
  }

  // ── Closer ──
  const closerParts: string[] = [];

  if (hasEliteStuff && hasEliteCommand) {
    closerParts.push("One of the best pitchers in the sport.");
  } else if (hasEliteStuff && hasBelowCommand) {
    closerParts.push("Elite ceiling with real variance.");
  } else if (sinkerProfile) {
    closerParts.push("The combination of above-average whiff, elite strike-throwing ability, and elite ground ball rates is a recipe for a high-level pitcher year over year. Limited variance because the ground ball skill translates across every level. All-American caliber arm.");
  } else if (chaseDependentProfile) {
    // No closer — the chase paragraph IS the closer
  } else if (hasAvgStuff && hasEliteCommand) {
    closerParts.push("Reliable innings eater. Could have an All-Conference season, but the lack of swing-and-miss limits the upside.");
  } else {
    closerParts.push(`${pctToTier(p.stuffPlus || 50).charAt(0).toUpperCase() + pctToTier(p.stuffPlus || 50).slice(1)} overall projection.`);
  }

  // Competition note
  if (input.conference) {
    const conf = input.conference.toLowerCase();
    const isMidMajor = !["sec", "acc", "big 12", "big ten", "pac-12"].some((c) => conf.includes(c));
    if (isMidMajor && (hasEliteStuff || hasPlusStuff)) {
      closerParts.push("Some competition concerns as a mid-major pitcher, but the stuff and in-zone whiff show it's not a fluke.");
    }
  }

  if (closerParts.length > 0) paragraphs.push(closerParts.join(" "));

  return paragraphs.join("\n\n");
}
