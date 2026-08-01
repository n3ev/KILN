export type RestrictedSeverity = "prohibited" | "restricted" | "age-gated" | "licence-required";

export interface RestrictedCategoryRule {
  readonly pattern: RegExp;
  readonly category: string;
  readonly severity: RestrictedSeverity;
  /** `*` means the platform/provider restriction applies everywhere. */
  readonly jurisdictions: readonly string[];
}

/** Prompt-1 fail-closed screen; legal/provider review must version later changes. */
export const RESTRICTED_CATEGORY_RULES: readonly RestrictedCategoryRule[] = [
  { pattern: /\b(cbd|cannabis|thc|kratom|cocaine|heroin|meth(?:amphetamine)?|psychedelic|controlled substance)\b/i, category: "controlled-substances", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(vape|e-?cigarette|nicotine|tobacco)\b/i, category: "nicotine", severity: "age-gated", jurisdictions: ["*"] },
  { pattern: /\b(alcohol|spirits|wine|beer|brewery)\b/i, category: "alcohol", severity: "licence-required", jurisdictions: ["*"] },
  { pattern: /\b(supplement|nootropic|vitamin|weight ?loss)\b/i, category: "supplements", severity: "restricted", jurisdictions: ["*"] },
  { pattern: /\b(firearm|ammunition|knife|weapon|taser|explosive)\b/i, category: "weapons", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(adult content|pornograph|escort service|sexual service)\b/i, category: "adult-content", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(mlm|multi[- ]level marketing|pyramid scheme)\b/i, category: "mlm", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(counterfeit|fake designer|replica branded|unlicensed trademark|knock-?off)\b/i, category: "counterfeit-goods", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(prescription|medicine|medical device|diagnos|guaranteed cure)\b/i, category: "regulated-medical", severity: "licence-required", jurisdictions: ["*"] },
  { pattern: /\b(guaranteed income|guaranteed returns?|unlicensed financial advice|token sale)\b/i, category: "regulated-financial", severity: "prohibited", jurisdictions: ["*"] },
  { pattern: /\b(cosmetic|skincare|lotion|serum)\b/i, category: "cosmetics", severity: "restricted", jurisdictions: ["*"] },
  { pattern: /\b(baby|infant|toy|children)\b/i, category: "childrens-products", severity: "restricted", jurisdictions: ["*"] },
  { pattern: /\b(food|edible|bakery|honey|coffee)\b/i, category: "food", severity: "licence-required", jurisdictions: ["*"] },
];
