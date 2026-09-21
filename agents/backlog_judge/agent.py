# -*- coding: utf-8 -*-


class BacklogJudge:
    """Makes the final deterministic gate decision for backlog findings."""

    BLOCKING_CODES = {
        "unknown_dependency",
        "contaminated_story_content",
        "generic_actor",
        "malformed_story_goal",
        "missing_acceptance_criteria",
    }
    # Only low-impact duplication is advisory. Scope, observability and
    # confirmed-integration gaps must be repaired before publication.
    ADVISORY_CODES = {
        "duplicate_open_questions",
    }

    def process(self, findings):
        findings = list(findings or [])
        advisories = [item for item in findings if isinstance(item, dict) and item.get("code") in self.ADVISORY_CODES]
        repair_findings = [item for item in findings if isinstance(item, dict) and item.get("code") not in self.ADVISORY_CODES]
        if any(item.get("code") in self.BLOCKING_CODES for item in repair_findings):
            decision = "BLOCK"
        elif repair_findings:
            decision = "REVISE"
        else:
            decision = "PASS"
        return {"decision": decision, "findings": repair_findings, "advisories": advisories}
