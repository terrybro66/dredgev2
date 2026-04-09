/**
 * food-business-gb/index.ts — Phase D.5
 *
 * RegulatoryAdapter for UK food business registration eligibility.
 *
 * Rules based on UK Food Standards Agency guidance:
 *   https://www.food.gov.uk/business-guidance/register-a-food-business
 *
 * Required attributes:
 *   business_type  — "New business" | "Change of use" | "Change of ownership"
 *   food_type      — "Restaurant / café" | "Takeaway" | "Market stall" |
 *                    "Home catering" | "Food manufacturer" | "Other"
 *
 * Logic:
 *   All food businesses in England, Wales, and Northern Ireland must register
 *   with their local authority at least 28 days before opening.
 *   Scotland uses the same requirement under different legislation.
 *   Registration is free and cannot be refused.
 *
 *   Conditions vary by food_type:
 *     - Any food business: must register with local authority
 *     - Food manufacturer / home catering: additional food hygiene certificate recommended
 *     - Takeaway: must display food hygiene rating
 *     - Market stall: may need additional street trading licence
 */

import type { ClarificationField, DecisionResult } from "../../types/connected";
import type { RegulatoryAdapter } from "../../regulatory-adapter";
import { getMissingAttributeQuestions } from "../../regulatory-adapter";

const FIELD_DEFS: ClarificationField[] = [
  {
    field:      "business_type",
    prompt:     "Is this a new business or a change of use?",
    input_type: "select",
    options:    ["New business", "Change of use", "Change of ownership"],
    target:     "user_attributes",
  },
  {
    field:      "food_type",
    prompt:     "What type of food operation is it?",
    input_type: "select",
    options:    [
      "Restaurant / café",
      "Takeaway",
      "Market stall",
      "Home catering",
      "Food manufacturer",
      "Other",
    ],
    target:     "user_attributes",
  },
];

const REQUIRED = ["business_type", "food_type"];

const BASE_CONDITIONS = [
  "Register with your local authority at least 28 days before opening",
  "Registration is free and cannot be refused",
  "You must notify your local authority of any significant changes after registration",
];

const BASE_REFERENCES = [
  "https://www.food.gov.uk/business-guidance/register-a-food-business",
  "https://www.gov.uk/food-business-registration",
];

function buildConditions(foodType: string): string[] {
  const conditions = [...BASE_CONDITIONS];

  switch (foodType) {
    case "Food manufacturer":
    case "Home catering":
      conditions.push(
        "Consider obtaining a Food Hygiene certificate (Level 2 Award in Food Safety)",
        "Ensure your premises meet structural hygiene requirements",
      );
      break;
    case "Takeaway":
      conditions.push(
        "You must display your Food Hygiene Rating prominently at the premises",
        "Ensure adequate ventilation and grease trap provisions",
      );
      break;
    case "Market stall":
      conditions.push(
        "Check whether your local authority requires a separate street trading licence",
        "Ensure you have access to adequate handwashing facilities",
      );
      break;
    case "Restaurant / café":
      conditions.push(
        "Staff handling food must receive appropriate food hygiene training",
      );
      break;
  }

  return conditions;
}

export const foodBusinessGbAdapter: RegulatoryAdapter = {
  name:               "food-business-gb",
  intents:            [
    "food business registration",
    "food business licence",
    "start a food business",
    "register a food business",
    "food hygiene rating",
    "food premises registration",
  ],
  countries:          ["GB"],
  requiredAttributes: REQUIRED,

  async evaluate(userAttributes: Record<string, unknown>): Promise<DecisionResult> {
    const missing = getMissingAttributeQuestions(REQUIRED, userAttributes, FIELD_DEFS);

    if (missing.length > 0) {
      return {
        eligibility:    "conditional",
        conditions:     [],
        next_questions: missing,
        references:     BASE_REFERENCES,
      };
    }

    const foodType = String(userAttributes.food_type ?? "Other");

    return {
      eligibility:    "eligible",
      conditions:     buildConditions(foodType),
      next_questions: [],
      references:     BASE_REFERENCES,
    };
  },
};
