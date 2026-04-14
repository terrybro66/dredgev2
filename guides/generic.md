# Building a Generic Adapter with Flexible Domain Schemas

## 🧠 The Core Problem

You want:

- **One execution engine (generic adapter)**
- **Many different domain schemas (crime, weather, cinemas, etc.)**

This creates a tension:

> How do you standardise behaviour without forcing all data into the same shape?

---

## 🔑 The Key Idea

> **Standardise behaviour, not data shape**

The generic adapter should:

- Accept **any raw schema**
- Map it into a **canonical analytical model**
- Preserve the **original raw structure**

---

# 🧱 The Three-Layer Model

Every domain should exist in three parallel representations:

---

## 1. 🔵 Raw Layer (Source Truth)

Exactly what the API returns.

```ts
{
  category: "burglary",
  location: {
    latitude: "51.5",
    longitude: "-0.1"
  },
  month: "2024-01"
}
```

- Never modified
- Never “fixed”
- Always stored

---

## 2. 🟡 Canonical Layer (Standardised)

Mapped using `DomainConfig.schema`.

```ts
{
  lat: 51.5,
  lon: -0.1,
  date: "2024-01",
  category: "burglary",
  value: 1
}
```

Used for:

- Maps
- Charts
- Filtering
- Aggregation
- Joins

---

## 3. 🟢 Semantic Layer (Meaning)

Defines what fields _represent_.

```ts
{
  date: { role: "time", resolution: "month" },
  category: { role: "dimension" },
  value: { role: "metric" }
}
```

Used for:

- Reasoning
- Aggregation logic
- Cross-domain comparison

---

# ⚙️ What the Generic Adapter Actually Does

The adapter is a **pipeline**, not just a mapper.

---

## Step 1 — Fetch

```ts
const raw = await fetch(source.endpoint);
```

- No schema assumptions
- Domain-specific shapes allowed

---

## Step 2 — Normalize

```ts
const canonical = raw.map((row) => mapFields(row, config.schema.fields));
```

- Uses config-driven mapping
- Converts raw → canonical

---

## Step 3 — Enrich

```ts
const enriched = applySemantics(canonical, config.schema);
```

Examples:

- Parse dates
- Convert numbers
- Apply transforms

---

## Step 4 — Store

```ts
{
  canonical: { lat, lon, date, category, value },
  raw: originalRow
}
```

- Canonical = usable
- Raw = lossless backup

---

## Step 5 — Execute

All logic now runs on **canonical + semantic layers**:

- Filtering
- Aggregation
- Recovery
- Cross-domain joins

---

# 🎯 Allowing Unique Schema Shapes

You don’t standardise structure—you standardise **interpretation**.

---

## Example: Crime

```ts
fields: {
  date: { source: "month", type: "time" },
  category: { source: "category", type: "enum" },
  lat: { source: "location.latitude" },
  lon: { source: "location.longitude" }
}
```

---

## Example: Weather

```ts
fields: {
  date: { source: "date", type: "time" },
  value: { source: "temperature_max", type: "number", role: "metric" }
}
```

---

## Example: Cinemas

```ts
fields: {
  label: { source: "name", role: "label" },
  lat: { source: "lat" },
  lon: { source: "lon" }
}
```

---

### Result

Different shapes → Same meaning:

| Concept  | Crime   | Weather     | Cinema  |
| -------- | ------- | ----------- | ------- |
| Time     | month   | date        | ❌      |
| Metric   | count   | temperature | ❌      |
| Location | lat/lon | lat/lon     | lat/lon |

---

# 🔑 The Critical Abstraction: Roles

Instead of fixed columns:

```ts
{
  (date, lat, lon, value);
}
```

Use:

```ts
role: "time" | "metric" | "dimension" | "location" | "label";
```

---

## Why Roles Matter

The system doesn’t care about field names.

It asks:

- What is the time field?
- What is the metric?
- What is the location?

---

# 🧠 How This Enables Insight

Once roles exist, you unlock:

---

## Cross-Domain Comparison

- Crime → metric = count
- Weather → metric = temperature

→ Compare trends

---

## Spatial Joins

- Crime → points
- Flood → polygons

→ Detect overlap

---

## Aggregation

- Group by category
- Sum or count values

---

## Key Insight

> None of this depends on original schema shape.

---

# ⚠️ Common Failure Modes

---

## ❌ 1. Forcing a Fixed Schema

```ts
{
  (lat, lon, date, value);
}
```

Breaks:

- Regulatory domains
- Non-numeric datasets
- Complex structures

---

## ❌ 2. Letting Raw JSON Leak Into Logic

```ts
row.extras.someField;
```

Problem:

- Breaks abstraction
- Prevents generalisation

---

## ❌ 3. Weak Schema Definitions

```ts
source: "field.path";
```

Missing:

- Meaning
- Aggregation ability
- Insight capability

---

# 🚀 The Big Picture

This system becomes:

> **A compiler from arbitrary APIs → structured analytical data**

---

# 🧾 Final Answer

## How do you build a generic adapter with unique schemas?

You:

1. Accept any raw schema
2. Map to a canonical structure via config
3. Assign semantic roles to fields
4. Run all logic on roles (not field names)
5. Store both canonical + raw

---

# 🔑 One Sentence Summary

> The generic adapter works because it standardises _meaning_, not _structure_.
