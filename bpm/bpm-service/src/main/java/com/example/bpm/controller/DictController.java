package com.example.bpm.controller;

import com.example.bpm.auth.AuthInterceptor;
import com.example.bpm.auth.Result;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.*;

/**
 * Dictionary + form definition management controller.
 * Provides field/node dictionaries and form definition CRUD under /api/dict/.
 */
@RestController
@RequestMapping("/api/dict")
public class DictController {

    private final JdbcTemplate db;
    private final ObjectMapper json = new ObjectMapper();

    public DictController(JdbcTemplate db) { this.db = db; }

    // ====================== Field Dictionary ======================

    /** All available fields (organized by category) */
    @GetMapping("/fields")
    public Result<?> dictFields(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "form:view");
        return Result.ok(List.of(
            // ---- Basic Info ----
            field("contractTitle",  "Contract Title",      "text",     "Basic Info",  true,  "e.g. 2026 Server Procurement Contract"),
            field("contractNo",     "Contract No.",         "text",     "Basic Info",  false, "Auto-generated"),
            field("contractType",   "Contract Type",        "select",   "Basic Info",  true,  null,
                  "Purchase", "Service", "NDA", "Strategic", "Other"),
            field("signDate",       "Sign Date",            "date",     "Basic Info",  true,  null),
            field("effectiveDate",  "Effective Date",       "date",     "Basic Info",  false, null),
            field("expireDate",     "Expire Date",          "date",     "Basic Info",  false, null),
            field("urgency",        "Urgency",              "select",   "Basic Info",  true,  null,
                  "Normal", "Urgent", "Critical"),
            // ---- Amount ----
            field("amount",         "Contract Amount",      "number",   "Amount",      true,  null),
            field("currency",       "Currency",             "select",   "Amount",      true,  null,
                  "CNY", "USD", "EUR"),
            field("paymentTerms",   "Payment Terms",        "select",   "Amount",      true,  null,
                  "Full Payment", "Installment", "Post-Acceptance", "Prepay+Balance"),
            field("budgetSource",   "Budget Source",        "text",     "Amount",      false, "e.g. 2026 IT Procurement Budget"),
            // ---- Parties ----
            field("vendor",         "Vendor Name",          "text",     "Parties",     true,  "Full legal name"),
            field("vendorContact",  "Vendor Contact",       "text",     "Parties",     false, null),
            field("vendorPhone",    "Vendor Phone",         "text",     "Parties",     false, null),
            field("ourParty",       "Our Party",            "select",   "Parties",     true,  null,
                  "Tech Co. Ltd.", "Tech Co. Shanghai Branch", "Tech Co. Shenzhen Branch"),
            // ---- Dynamic Data Source ----
            fieldDs("responsibleDept",   "Responsible Dept.",  "select", "Parties",  false, "/org/departments", "id", "name"),
            fieldDs("responsiblePerson", "Responsible Person", "select", "Parties",  false, "/org/users",       "id", "name"),
            // ---- Contract Content ----
            field("description",    "Contract Summary",     "textarea", "Content",     true,  "Brief description of scope"),
            field("scopeOfWork",    "Scope of Work",        "textarea", "Content",     false, "Detailed deliverables"),
            field("deliveryReq",    "Delivery Requirements","textarea", "Content",     false, "Time, place, method"),
            field("acceptanceStd",  "Acceptance Criteria",  "textarea", "Content",     false, "Quality standards"),
            // ---- Approval ----
            field("opinion",        "Approval Opinion",     "textarea", "Approval",    false, null),
            field("legalOpinion",   "Legal Opinion",        "textarea", "Approval",    false, null),
            field("financialOpinion","Financial Opinion",   "textarea", "Approval",    false, null),
            field("decision",       "Decision",             "select",   "Approval",    false, null,
                  "Approve", "Reject", "Return for Revision"),
            // ---- Archive ----
            field("archiveNo",      "Archive No.",          "text",     "Archive",     false, "Archive room reference"),
            field("attachments",    "Attachments",          "textarea", "Archive",     false, null),
            field("remarks",        "Remarks",              "textarea", "Archive",     false, null)
        ));
    }

    // ====================== Node Dictionary ======================

    /** Available process nodes */
    @GetMapping("/nodes")
    public Result<?> dictNodes(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "form:view");
        return Result.ok(List.of(
            node("submitContract",    "Submit Contract",       1,  "Initiator fills contract and submits"),
            node("legalReview",       "Legal Review",          2,  "Legal department reviews compliance"),
            node("financialReview",   "Financial Review",      3,  "Finance reviews budget and payment terms"),
            node("managerReview",     "Manager Approval",      4,  "Direct manager approval"),
            node("directorApprove",   "Director Approval",     5,  "Department director final approval"),
            node("sealAndArchive",    "Seal and Archive",      6,  "Apply official seal and archive"),
            node("approvedNotice",    "Approval Notice",       7,  "Notify initiator contract approved"),
            node("rejectedNotice",    "Rejection Notice",      8,  "Notify initiator contract rejected with reason")
        ));
    }

    // ====================== Form Definition CRUD ======================

    /** List all form definitions */
    @GetMapping("/forms")
    public Result<?> listForms(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "form:view");
        return Result.ok(db.query(
            "SELECT id, form_key, name FROM form_definitions ORDER BY id",
            (rs, i) -> Map.of(
                "id", rs.getString("id"),
                "formKey", rs.getString("form_key"),
                "name", rs.getString("name")
            )
        ));
    }

    /** Load a single form */
    @GetMapping("/forms/{formKey}")
    public Result<?> getForm(@PathVariable String formKey, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "form:view");
        var list = db.query("SELECT schema_json, name, form_key FROM form_definitions WHERE form_key=?",
                (rs, i) -> Map.of("schema", rs.getString("schema_json"), "name", rs.getString("name"), "formKey", rs.getString("form_key")),
                formKey);
        if (list.isEmpty()) return Result.fail("Form not found: " + formKey);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = json.readValue((String) list.get(0).get("schema"), Map.class);
            data.putIfAbsent("formKey", list.get(0).get("formKey"));
            data.putIfAbsent("name", list.get(0).get("name"));
            return Result.ok(data);
        } catch (Exception e) { return Result.fail("JSON parse failed"); }
    }

    /** Save / update form definition */
    @PostMapping("/forms/save")
    public Result<?> saveForm(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "form:design");
        String formKey = (String) body.get("formKey");
        String name = (String) body.get("name");
        @SuppressWarnings("unchecked")
        List<String> selectedFields = (List<String>) body.get("fields");
        @SuppressWarnings("unchecked")
        Map<String, Map<String, String>> nodeAcl = (Map<String, Map<String, String>>) body.get("nodeAcl");

        // Assemble full fields from dictionary
        List<Map<String, Object>> dict = (List<Map<String, Object>>) dictFields(request).data;
        List<Map<String, Object>> fullFields = new ArrayList<>();
        for (String fn : selectedFields) {
            for (Map<String, Object> f : dict) {
                if (fn.equals(f.get("name"))) {
                    Map<String, Object> copy = new LinkedHashMap<>(f);
                    copy.remove("category");
                    fullFields.add(copy);
                    break;
                }
            }
        }

        // Build schema
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("formKey", formKey);
        schema.put("name", name);
        schema.put("fields", fullFields);
        schema.put("nodeAcl", nodeAcl);

        try {
            String schemaJson = json.writeValueAsString(schema);

            // Upsert
            String existingId = null;
            List<String> ids = db.query("SELECT id FROM form_definitions WHERE form_key=?",
                    (rs, i) -> rs.getString("id"), formKey);
            if (!ids.isEmpty()) existingId = ids.get(0);

            if (existingId != null) {
                db.update("UPDATE form_definitions SET name=?, schema_json=? WHERE form_key=?",
                        name, schemaJson, formKey);
            } else {
                db.update("INSERT INTO form_definitions (id,form_key,name,schema_json) VALUES (?,?,?,?)",
                        UUID.randomUUID().toString().substring(0, 8), formKey, name, schemaJson);
            }

            return Result.ok(Map.of("formKey", formKey, "message", "Form definition saved"));
        } catch (Exception e) {
            return Result.fail(e.getMessage());
        }
    }

    // ---- helpers ----
    private Map<String, Object> field(String name, String label, String type, String category,
                                       boolean required, String placeholder, String... options) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("label", label);
        m.put("type", type);
        m.put("category", category);
        m.put("required", required);
        if (placeholder != null) m.put("placeholder", placeholder);
        if (options.length > 0) m.put("options", List.of(options));
        return m;
    }

    private Map<String, Object> fieldDs(String name, String label, String type, String category,
                                          boolean required, String api, String valueKey, String labelKey) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("label", label);
        m.put("type", type);
        m.put("category", category);
        m.put("required", required);
        m.put("dataSource", Map.of("api", api, "valueKey", valueKey, "labelKey", labelKey));
        return m;
    }

    private Map<String, Object> node(String key, String label, int order, String desc) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("label", label);
        m.put("order", order);
        m.put("description", desc);
        return m;
    }
}
