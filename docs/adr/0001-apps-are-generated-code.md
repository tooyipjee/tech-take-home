# 0001 — Apps are generated code over a capability layer

**Status:** accepted

## Context

The obvious build is a Power Apps clone: a drag-and-drop canvas, a component tree, data bindings.
That is roughly ten times the surface area, and the result competes with Retool on Retool's terms.

Our apps are built by Devin from a playbook. A generator does not need a canvas — it needs a
narrow, well-typed target and fast feedback. A canvas would actively hurt: it constrains what can
be expressed while adding an editor nobody asked for.

## Decision

An app is a code module. Devin writes it. The platform provides identity, data access, policy
enforcement and audit; the app provides a screen and a sequence of capability invocations.

## Consequences

- Building an app is a prompt plus a review, not a project.
- Anything a screen can express is available — no canvas ceiling.
- Generated code cannot be trusted, so nothing load-bearing may live in it. That constraint is
  what [0002](0002-policy-is-declared-not-implemented.md) exists to satisfy.
- App boundaries need mechanical enforcement, not convention: `npm run lint` fails the build if an
  app reaches past the SDK.
