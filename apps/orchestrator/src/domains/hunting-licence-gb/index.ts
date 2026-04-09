/**
 * hunting-licence-gb/index.ts — Phase D.11
 *
 * RegulatoryAdapter for GB hunting licence eligibility.
 *
 * Rules based on UK Wildlife and Countryside Act 1981, Deer Act 1991,
 * and Natural England open access land guidance.
 *
 * Required attributes:
 *   age          — number
 *   residency    — boolean (UK resident)
 *   game_species — "Deer" | "Pheasant" | "Grouse" | "Duck" | "Other"
 *
 * Logic:
 *   Under 14    → ineligible (no licence available at any age below 14)
 *   14–17       → conditional (must be supervised by licence holder aged 21+)
 *   18+         → eligible, with species-specific conditions
 *
 * On a full "eligible" decision the adapter returns a suggested_chips entry
 * that triggers a hunting zones fetch so the user can immediately find
 * suitable land near them.
 */

import type {
  ClarificationField,
  DecisionResult,
  Chip,
} from "../../types/connected";
import type { RegulatoryAdapter } from "../../regulatory-adapter";
import { getMissingAttributeQuestions } from "../../regulatory-adapter";

const FIELD_DEFS: ClarificationField[] = [
  {
    field: "age",
    prompt: "How old are you?",
    input_type: "number",
    target: "user_attributes",
  },
  {
    field: "residency",
    prompt: "Are you a UK resident?",
    input_type: "boolean",
    target: "user_attributes",
  },
  {
    field: "game_species",
    prompt: "Which game species are you interested in?",
    input_type: "select",
    options: ["Deer", "Pheasant", "Grouse", "Duck", "Other"],
    target: "user_attributes",
  },
];

const REQUIRED = ["age", "residency", "game_species"];

const BASE_REFERENCES = [
  "https://www.gov.uk/hunting",
  "https://www.gov.uk/government/publications/deer-management-guidance",
  "https://www.basc.org.uk/game-and-gamekeeping/",
];

const FIND_ZONES_CHIP: Chip = {
  label: "Find hunting zones near me",
  action: "fetch_domain",
  args: { domain: "hunting-zones-gb" },
};

function buildConditions(
  age: number,
  species: string,
  resident: boolean,
): string[] {
  const conditions: string[] = [];

  if (!resident) {
    conditions.push(
      "Non-residents require a visitor's shooting permit arranged through an approved shooting estate",
      "Contact the British Association for Shooting and Conservation (BASC) for guidance on visiting shooter requirements",
    );
  }

  switch (species) {
    case "Deer":
      conditions.push(
        "A Deer Stalking Certificate (DSC Level 1) is strongly recommended before stalking unsupervised",
        "You must use appropriate calibre firearms — minimum .243 Win or equivalent for most species",
        "Deer may only be taken during legal open seasons; season dates vary by species and sex",
        "You must have permission from the landowner or occupier before stalking",
      );
      break;
    case "Pheasant":
    case "Grouse":
      conditions.push(
        `${species} shooting season: ${species === "Grouse" ? "12 Aug – 10 Dec" : "1 Oct – 1 Feb"}`,
        "You must hold a valid shotgun certificate (SGC) or firearms certificate (FAC)",
        "Driven and walked-up shooting on private land requires landowner/shoot organiser permission",
      );
      break;
    case "Duck":
      conditions.push(
        "Wildfowling season: 1 Sep – 20 Feb (inland); 1 Sep – 20 Feb (foreshore)",
        "Some tidal foreshore areas are Crown property and permit-free; check with the Crown Estate",
        "You must hold a valid shotgun certificate (SGC)",
        "Lead shot is prohibited over wetlands — use steel or approved non-toxic shot",
      );
      break;
    default:
      conditions.push(
        "Ensure you understand the specific season dates and legal methods for your chosen quarry species",
        "Check current BASC guidance for the species you intend to pursue",
      );
  }

  if (age >= 18) {
    conditions.push(
      "You may apply for a shotgun certificate (SGC) or firearms certificate (FAC) through your local police force",
    );
  }

  return conditions;
}

export const huntingLicenceGbAdapter: RegulatoryAdapter = {
  name: "hunting-licence-gb",
  intents: [
    "hunting licence eligibility",
    "hunting licence",
    "hunting permit",
    "deer stalking",
    "hunting license",
  ],
  countries: ["GB"],
  requiredAttributes: REQUIRED,

  async evaluate(
    userAttributes: Record<string, unknown>,
  ): Promise<DecisionResult> {
    const missing = getMissingAttributeQuestions(
      REQUIRED,
      userAttributes,
      FIELD_DEFS,
    );

    if (missing.length > 0) {
      return {
        eligibility: "conditional",
        conditions: [],
        next_questions: missing,
        references: BASE_REFERENCES,
      };
    }

    const age = Number(userAttributes.age ?? 0);
    const resident = Boolean(userAttributes.residency);
    const species = String(userAttributes.game_species ?? "Other");

    // Under 14 → ineligible
    if (age < 14) {
      return {
        eligibility: "ineligible",
        conditions: [
          "You must be at least 14 years old to participate in supervised shooting",
          "No hunting licence or shooting permit is available for those under 14",
        ],
        next_questions: [],
        references: BASE_REFERENCES,
      };
    }

    // 14–17 → conditional (supervised)
    if (age < 18) {
      return {
        eligibility: "conditional",
        conditions: [
          "You may participate in shooting activities under direct supervision of a certificate holder aged 21 or over",
          "You cannot hold a firearms or shotgun certificate in your own name until age 18",
          "A responsible adult must be present at all times during shooting",
          ...buildConditions(age, species, resident),
        ],
        next_questions: [],
        references: BASE_REFERENCES,
      };
    }

    // 18+ → eligible
    return {
      eligibility: "eligible",
      conditions: buildConditions(age, species, resident),
      next_questions: [],
      references: BASE_REFERENCES,
      suggested_chips: [FIND_ZONES_CHIP],
    };
  },
};
