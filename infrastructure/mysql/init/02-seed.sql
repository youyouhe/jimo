-- ============================================================
-- Seed data — runs after 01-schema.sql on first container start.
-- Uses INSERT IGNORE to be idempotent.
-- ============================================================

-- Departments
INSERT IGNORE INTO departments (id, name, parent_id, lead_id) VALUES
('D000', '运营中心',  NULL,  'EMP008'),
('D001', '采购部',   'D000', 'EMP003'),
('D002', '法务部',   'D000', 'EMP007'),
('D003', '财务部',    NULL,  'EMP004'),
('D004', '技术部',    NULL,  'EMP006');

-- Users
INSERT IGNORE INTO users (id, name, dept_id, email, title) VALUES
('EMP001', '张三',   'D001', 'zhangsan@corp.com',   '采购专员'),
('EMP002', '李四',   'D001', 'lisi@corp.com',       '采购助理'),
('EMP003', '王经理', 'D001', 'wangjl@corp.com',     '采购经理'),
('EMP004', '赵总监', 'D003', 'zhaozj@corp.com',     '财务总监'),
('EMP005', '张三',   'D002', 'zhangsan2@corp.com',  '法务专员'),
('EMP006', '陈总',   'D004', 'chenz@corp.com',      '技术总监'),
('EMP007', '刘律师', 'D002', 'liuls@corp.com',      '法务经理'),
('EMP008', '周总裁', 'D000', 'zhouzc@corp.com',     '首席执行官');

-- Resolution rules
INSERT IGNORE INTO resolution_rules (rule_name, label, strategy, config_json) VALUES
('deptHead',  '部门负责人',   'SELF_DEPT_LEAD', '{}'),
('divHead',   '分管领导',     'PARENT_DEPT_LEAD','{}'),
('ceo',       '公司总裁',     'BY_TITLE',       '{"title":"首席执行官"}'),
('deptFinance','财务负责人',  'FIXED_DEPT_LEAD','{"deptId":"D003"}'),
('legalReview','法务审核',    'FIXED_DEPT_LEAD','{"deptId":"D002"}'),
('specific',  '指定人员',     'BY_USER_ID',     '{}');

-- Form definition
INSERT IGNORE INTO form_definitions (id, form_key, name, schema_json) VALUES
('FD001', 'purchase_contract', '采购合同', '{"fields":[{"name":"contractTitle","label":"合同标题","type":"text","required":true,"placeholder":"如：2026年度服务器采购合同"},{"name":"vendor","label":"供应商","type":"text","required":true,"placeholder":"供应商全称"},{"name":"amount","label":"合同金额","type":"number","required":true,"unit":"万元"},{"name":"category","label":"采购类别","type":"select","required":true,"options":["IT设备","办公用品","服务采购","其他"]},{"name":"description","label":"采购说明","type":"textarea","required":false,"placeholder":"详细说明采购内容"},{"name":"opinion","label":"审批意见","type":"textarea","required":false},{"name":"contractNo","label":"合同编号","type":"text","required":false}],"nodeAcl":{"submitContract":{"contractTitle":"rw","vendor":"rw","amount":"rw","category":"rw","description":"rw","opinion":"-","contractNo":"-"},"managerReview":{"contractTitle":"r","vendor":"r","amount":"r","category":"r","description":"r","opinion":"rw","contractNo":"-"},"approvedNotice":{"contractTitle":"r","vendor":"r","amount":"r","category":"r","description":"r","opinion":"r","contractNo":"rw"},"rejectedNotice":{"contractTitle":"r","vendor":"r","amount":"r","category":"r","description":"r","opinion":"r","contractNo":"-"}}}');

-- Contract categories
INSERT IGNORE INTO contract_categories (id, name, code, approval_chain, amount_rules, form_key, enabled, sort_order) VALUES
('CC01', '采购合同', 'purchase', '["deptHead","deptFinance"]',
 '[{"max":100000,"chain":["deptHead"]},{"max":1000000,"chain":["deptHead","deptFinance"]},{"max":999999999,"chain":["deptHead","deptFinance","ceo"]}]',
 'purchase_contract', 1, 1),
('CC02', '销售合同', 'sales', '["deptHead","legalReview"]',
 '[{"max":999999999,"chain":["deptHead","legalReview"]}]',
 NULL, 1, 2),
('CC03', '框架协议', 'framework', '["deptHead","legalReview","deptFinance","ceo"]',
 '[{"max":999999999,"chain":["deptHead","legalReview","deptFinance","ceo"]}]',
 NULL, 1, 3),
('CC04', '保密协议', 'nda', '["deptHead"]',
 '[{"max":999999999,"chain":["deptHead"]}]',
 NULL, 1, 4),
('CC05', '服务合同', 'service', '["deptHead","deptFinance"]',
 '[{"max":500000,"chain":["deptHead"]},{"max":999999999,"chain":["deptHead","deptFinance"]}]',
 NULL, 1, 5);

-- Roles
INSERT IGNORE INTO roles (id, code, name, description, is_system) VALUES
('R01', 'ROLE_ADMIN',         '系统管理员', '拥有全部权限', 1),
('R02', 'ROLE_CONTRACT_MGR',  '合同管理员', '合同全生命周期管理及审批', 1),
('R03', 'ROLE_USER',          '普通用户',   '查看合同、创建和提交自己的合同', 1),
('R04', 'ROLE_FORM_DESIGNER', '表单设计者', '表单设计与查看', 1);

-- Permissions
INSERT IGNORE INTO permissions (id, code, name, module) VALUES
('P01',  'contract:list',    '查看合同列表', 'contract'),
('P02',  'contract:view',    '查看合同详情', 'contract'),
('P03',  'contract:create',  '创建合同',     'contract'),
('P04',  'contract:edit',    '编辑合同',     'contract'),
('P05',  'contract:delete',  '删除合同',     'contract'),
('P06',  'contract:submit',  '提交审批',     'contract'),
('P07',  'contract:approve', '审批合同',     'contract'),
('P08',  'contract:status',  '变更合同状态', 'contract'),
('P09',  'form:view',        '表单查看',     'form'),
('P10',  'form:design',      '表单设计',     'form'),
('P11',  'process:view',     '查看流程',     'process'),
('P12',  'process:start',    '启动流程',     'process'),
('P13',  'process:deploy',   '部署流程',     'process'),
('P14',  'admin:version',    '版本管理',     'admin'),
('P15',  'role:manage',      '角色权限管理', 'role'),
('P16',  'user:manage',      '用户管理',     'role'),
('P17',  'contract:list_all','查看全部合同',  'contract'),
('P18',  'contract:edit_all','编辑全部合同',  'contract');

-- Role-Permissions: Admin
INSERT IGNORE INTO role_permissions (id, role_id, permission_id) VALUES
('RP01','R01','P01'),('RP02','R01','P02'),('RP03','R01','P03'),('RP04','R01','P04'),
('RP05','R01','P05'),('RP06','R01','P06'),('RP07','R01','P07'),('RP08','R01','P08'),
('RP09','R01','P09'),('RP10','R01','P10'),('RP10B','R01','P11'),('RP11','R01','P12'),
('RP12','R01','P13'),('RP13','R01','P14'),('RP14','R01','P15'),('RP15','R01','P16'),
('RP16','R01','P17'),('RP17','R01','P18');

-- Role-Permissions: Contract Manager
INSERT IGNORE INTO role_permissions (id, role_id, permission_id) VALUES
('RP20','R02','P01'),('RP21','R02','P02'),('RP22','R02','P03'),('RP23','R02','P04'),
('RP24','R02','P05'),('RP25','R02','P06'),('RP26','R02','P07'),('RP27','R02','P08'),
('RP28','R02','P09'),('RP29','R02','P11'),('RP29B','R02','P17'),('RP29C','R02','P18');

-- Role-Permissions: Regular User
INSERT IGNORE INTO role_permissions (id, role_id, permission_id) VALUES
('RP30','R03','P01'),('RP31','R03','P02'),('RP32','R03','P03'),('RP33','R03','P04'),
('RP34','R03','P06'),('RP35','R03','P09');

-- Role-Permissions: Form Designer
INSERT IGNORE INTO role_permissions (id, role_id, permission_id) VALUES
('RP40','R04','P09'),('RP41','R04','P10'),('RP42','R04','P01'),('RP43','R04','P02');

-- User-Role assignments
INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES
('UR01','EMP008','R01'),
('UR02','EMP003','R02'),('UR03','EMP004','R02'),('UR04','EMP007','R02'),
('UR05','EMP001','R03'),('UR06','EMP002','R03'),('UR07','EMP005','R03'),
('UR08','EMP006','R04');

-- Menu items
INSERT IGNORE INTO menu_items (id, code, label, icon, group_name, sort_order, link, permission_code, is_placeholder) VALUES
('M01','contract-list','合同列表','📋','合同管理', 1, NULL,          'contract:list',  0),
('M02','contract-tpl', '合同模板','📄','合同管理', 2, NULL,          NULL,             1),
('M03','approval-mgmt','审批管理','✅','合同管理', 3, NULL,          NULL,             1),
('M04','statistics',   '统计报表','📊','合同管理', 4, NULL,          NULL,             1),
('M05','form-design',  '表单设计','🎨','表单配置', 1, 'form-admin.html', 'form:design', 0),
('M06','form-demo',    '表单演示','🧪','表单配置', 2, 'form-demo.html',  'form:view',   0),
('M07','version-mgmt', '版本管理','📦','系统管理', 1, 'version-dashboard.html', 'admin:version', 0),
('M08','dict',         '数据字典','📖','系统管理', 2, NULL,          NULL,             1),
('M09','process-cfg',  '流程配置','⚙️','系统管理', 3, NULL,          'process:deploy', 1),
('M10','role-mgmt',    '角色权限','👥','系统管理', 4, NULL,          'role:manage',    0);
