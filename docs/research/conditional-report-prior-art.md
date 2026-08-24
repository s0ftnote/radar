# Condition-driven alert and report generation: product prior art

Research date: 2026-08-24
Scope: official, first-party product documentation only.

## Product facts

### Datadog Monitors: evaluate a condition, not merely an arrival

- Datadog exposes several detection semantics over observed data: a fixed threshold, an absolute or percentage change from an earlier period, and anomaly detection against an expected range learned from historical behavior. A change alert aggregates the difference over an evaluation window and compares the resulting value with a threshold; an anomaly alert triggers only when a configured proportion of the series lies outside the expected range. This is a concrete precedent for separating raw observations from a decision that the observed change is significant. ([Monitor types](https://docs.datadoghq.com/monitors/types/), [Change Alert Monitor](https://docs.datadoghq.com/monitors/types/change-alert/), [Metric Monitor](https://docs.datadoghq.com/monitors/types/metric/))
- Trigger and recovery can have separate conditions. Anomaly monitors have distinct trigger and recovery windows; ordinary monitors can use a separate recovery threshold. This introduces hysteresis so a signal does not flap around one boundary. ([Anomaly Monitor](https://docs.datadoghq.com/monitors/types/anomaly/), [Configure Monitors](https://docs.datadoghq.com/monitors/configuration/))
- Notifications have their own persistence policy after detection: users can choose the states eligible for renotification, a renotification interval, and a maximum number of repeats. Grouped queries can also remove dimensions from notification grouping or collapse to a simple alert. ([Notifications](https://docs.datadoghq.com/monitors/notify/))
- Datadog can delay evaluation for newly observed groups and for late-arriving data, preventing expected startup or ingestion behavior from immediately becoming an alert. ([Configure Monitors](https://docs.datadoghq.com/monitors/configuration/))

### PagerDuty: correlate first, then interrupt

- PagerDuty can group related alerts into one incident using intelligent similarity and past co-occurrence, exact matches on selected content fields, a combination of the two, or time alone. Global grouping can span a user-selected set of services. ([Alert Grouping](https://support.pagerduty.com/main/docs/alert-grouping), [Global Alert Grouping](https://support.pagerduty.com/main/docs/global-alert-grouping))
- Its configurable grouping window is rolling: each matching alert extends the window, up to 24 hours or until the incident resolves. A late alert outside that bound starts a new incident. The grouping unit is therefore an evolving incident, not one notification per input event. ([Global Alert Grouping](https://support.pagerduty.com/main/docs/global-alert-grouping))
- Event Orchestration distinguishes pausing, suppressing, and dropping. A paused alert remains visible and may resolve during the waiting period without ever creating an incident or notifying responders; a suppressed alert remains visible but creates no incident or notification; a dropped event leaves no PagerDuty record. ([Event Orchestration](https://support.pagerduty.com/main/docs/event-orchestration))

### Google Alerts and GitHub Notifications: user-controlled scope and cadence

- Google Alerts lets a user choose the query plus notification frequency, source/site types, language, region, result quantity, and recipient account. This treats scope, relevance volume, cadence, and destination as separate choices. ([Create an alert](https://support.google.com/websearch/answer/4815696?hl=en))
- GitHub separates subscription scope from delivery. A repository can be watched for all activity or only selected event classes such as issues, pull requests, releases, security alerts, and discussions; participating and watching notifications can be delivered in the GitHub inbox, by email, or both. ([Configuring notifications](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications))

### Feedly AI Feeds: semantic matching plus duplicate control

- Feedly AI Feeds use concept models rather than only keyword occurrence, allow `AND`/`OR`/`NOT` composition, and can search title-only or title and content across a user-selected source scope. Feedly also provides a natural-language refinement layer for criteria such as keeping only substantial developments. ([How to create highly relevant AI Feeds](https://docs.feedly.com/article/699-guide-to-ai-feeds-market-intel), [Natural Language Filter](https://docs.feedly.com/article/812-how-to-use-the-natural-language-filter-on-ai-feeds))
- Feedly treats near-exact duplication and same-story clustering differently: articles with at least 85% overlap can be removed as duplicates, while differently written articles about the same topic or event are grouped rather than removed. ([Duplicate Articles](https://docs.feedly.com/article/202-duplicate-articles), [What is clustering?](https://docs.feedly.com/article/552-what-is-clustering))
- Users can route results through automated newsletters, private RSS, API, Slack, or Microsoft Teams. Feedly explicitly distinguishes fully automatic delivery from routing through a Team Board for manual curation. ([AI Feeds for threat intelligence](https://docs.feedly.com/article/739-ai-feeds-for-threat-intelligence))

## Cross-product pattern

| Concern | Repeated mature-product pattern |
| --- | --- |
| Trigger semantics | Evaluate a threshold, relative change, anomaly, semantic concept, or compound condition over observations; raw arrival is only input. |
| Grouping | Correlate by stable fields, semantic similarity, or a rolling time window; keep exact duplicate removal distinct from same-event clustering. |
| Notification pressure | Delay, suppress, pause, digest, or renotify according to state and time; detection and delivery have separate policies. |
| User control | Configure subject/source scope separately from sensitivity, cadence, recipient, and channel. |

## Inferences for Radar

The following are design inferences, not claims about the cited products.

1. **Make report generation a state-transition decision.** A source event should update Radar's evidence/state for a watched subject. Generate a report only when the accumulated evidence crosses an explicit material-change condition—for example, a new claim or changed status with sufficient confidence and impact—not merely because a new item arrived.
2. **Keep three different operations explicit:** exact deduplication, same-development clustering, and materiality evaluation. A repeated article may be discarded; a differently worded article may strengthen an existing development; only a materially changed development should become a new report.
3. **Give each candidate development an aggregation window.** Collect related evidence into one evolving candidate, using a stable subject/development key plus semantic similarity. Extend a bounded rolling window when corroborating evidence arrives, then generate one report from the cluster. Critical changes may bypass the wait.
4. **Put cooldown after generation eligibility, not before ingestion.** During cooldown, continue accumulating evidence. Send again only for a higher-severity transition or when a configured renotify/digest boundary is reached. Store a report fingerprint and last-delivered state so unchanged conclusions do not re-send.
5. **Separate four user choices:** watched scope (subjects/sources), materiality/sensitivity, cadence (immediate versus digest), and delivery (in-app/email/integration plus recipients). Avoid making channel choice implicitly change what Radar considers material.
6. **Preserve suppressed evidence.** The PagerDuty distinction is useful: muted or cooldown-blocked candidates should remain inspectable and explain why no report was produced; only verified ingestion noise should be dropped entirely.

## Smallest plausible Radar policy surface

For a walking skeleton, the prior art supports one durable internal rule—`material change since the last generated report`—plus only the user choices needed now: watch scope, immediate versus digest delivery, and destination. Exact deduplication, bounded same-development aggregation, a default cooldown, and stored suppression reasons can initially be system policy. More detection modes and tuning knobs should wait for demonstrated needs.
