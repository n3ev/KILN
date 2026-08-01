export const intakeFixture = {
  idea: "I want to run a same-day mobile bicycle repair service for weekday commuters in Leeds.",
  answers: [
    "Commuters lose a working bicycle for days when a conventional repair shop has a backlog.",
    "Weekday bicycle commuters in central Leeds who depend on one bicycle for transport.",
    "Same-day mobile bicycle repair for weekday commuters",
    "GBP 85 per appointment, with parts quoted before fitting.",
    "A mechanic comes to the customer's workplace and completes common repairs before the ride home.",
    "Local search, employer cycle-to-work groups, and referrals from independent bicycle shops.",
    "A typical GBP 85 booking uses GBP 18 of parts and 75 minutes of mechanic time.",
    "GBP 4,000 available for tools, insurance, and the first month of operations.",
    "20 hours each week for the first three months.",
    "Operate within 12 km of central Leeds, United Kingdom.",
    "In-person mobile service, normally completed on the same business day.",
    "No unsafe roadside work, no unquoted parts, and no customer bicycle kept overnight.",
  ],
  ventureName: "Same-day mobile bicycle repair for weekday commuters",
} as const;

export const completedVentures = [
  { name: "Ember & Ash", archetype: "physical", playbook: "physical-shopify" },
  { name: "Ledger Kit", archetype: "digital", playbook: "digital-product" },
  { name: "Cogwright", archetype: "service", playbook: "local-service" },
] as const;

