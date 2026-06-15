package com.example.bpm.service;

import com.example.bpm.repository.OrgRepository;
import com.example.bpm.repository.RuleRepository;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Resolves BPMN assignee expressions using rules from resolution_rules DB table.
 * Supports strategies: SELF_DEPT_LEAD, PARENT_DEPT_LEAD, FIXED_DEPT_LEAD, BY_TITLE, BY_USER_ID.
 * Usage in BPMN: flowable:assignee="${assigneeResolver.resolve('deptHead', initiator)}"
 */
@Component("assigneeResolver")
public class AssigneeResolver {

    private final OrgRepository orgRepository;
    private final RuleRepository ruleRepository;

    public AssigneeResolver(OrgRepository orgRepository, RuleRepository ruleRepository) {
        this.orgRepository = orgRepository;
        this.ruleRepository = ruleRepository;
    }

    /**
     * BPMN expression entry point: ${assigneeResolver.resolve('deptHead', initiator)}
     */
    public String resolve(String ruleName, String userId) {
        if (ruleName == null || userId == null) return null;

        Map<String, Object> rule = ruleRepository.findRule(ruleName);
        if (rule == null) {
            // Not a known rule, treat as user ID directly
            return orgRepository.userExists(userId) ? userId : null;
        }

        String strategy = (String) rule.get("strategy");
        @SuppressWarnings("unchecked")
        Map<String, Object> config = (Map<String, Object>) rule.get("config");

        return switch (strategy) {
            case "SELF_DEPT_LEAD" -> {
                String dept = orgRepository.getUserDept(userId);
                yield dept != null ? orgRepository.getDeptLead(dept) : null;
            }
            case "PARENT_DEPT_LEAD" -> {
                // Find the parent of the initiator's department, then get parent dept lead
                String dept = orgRepository.getUserDept(userId);
                String parent = orgRepository.getParentDept(dept);
                yield parent != null ? orgRepository.getDeptLead(parent) : null;
            }
            case "FIXED_DEPT_LEAD" -> {
                String deptId = config != null ? (String) config.get("deptId") : null;
                yield deptId != null ? orgRepository.getDeptLead(deptId) : null;
            }
            case "BY_TITLE" -> {
                String title = config != null ? (String) config.get("title") : null;
                yield title != null ? orgRepository.getUserByTitle(title) : null;
            }
            case "BY_USER_ID" -> {
                // Use the rule name as the userId
                yield orgRepository.userExists(ruleName) ? ruleName : null;
            }
            default -> null;
        };
    }

    /**
     * List all registered rules.
     */
    public List<Map<String, Object>> listRules() {
        return ruleRepository.listRules();
    }
}
