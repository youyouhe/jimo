-- H2-compatible business schema (no MySQL-specific types)
-- Flowable BPM tables are auto-created by Flowable engine.
-- TEXT → CLOB, TINYINT(1) → BOOLEAN

CREATE TABLE IF NOT EXISTS departments (
    id          VARCHAR(32)  PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    parent_id   VARCHAR(32),
    lead_id     VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS users (
    id          VARCHAR(32)  PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,
    dept_id     VARCHAR(32)  NOT NULL,
    email       VARCHAR(100),
    title       VARCHAR(50),
    FOREIGN KEY (dept_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS form_definitions (
    id          VARCHAR(32)  PRIMARY KEY,
    form_key    VARCHAR(100) NOT NULL UNIQUE,
    name        VARCHAR(200) NOT NULL,
    schema_json CLOB         NOT NULL
);

CREATE TABLE IF NOT EXISTS resolution_rules (
    rule_name       VARCHAR(50)  PRIMARY KEY,
    label           VARCHAR(100) NOT NULL,
    strategy        VARCHAR(30)  NOT NULL,
    config_json     CLOB
);

CREATE TABLE IF NOT EXISTS version_history (
    id              VARCHAR(32)  PRIMARY KEY,
    process_key     VARCHAR(100) NOT NULL,
    version         INT          NOT NULL,
    deployment_id   VARCHAR(64)  NOT NULL,
    change_log      CLOB,
    deployed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS form_data (
    id                    VARCHAR(32)  PRIMARY KEY,
    process_instance_id   VARCHAR(64)  NOT NULL,
    form_key              VARCHAR(100) NOT NULL,
    task_definition_key   VARCHAR(100),
    data_json             CLOB,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contracts (
    id                  VARCHAR(32)  PRIMARY KEY,
    contract_no         VARCHAR(50)  UNIQUE,
    title               VARCHAR(200) NOT NULL,
    category_id         VARCHAR(32)  NOT NULL,
    amount              DECIMAL(15,2),
    currency            VARCHAR(10)  DEFAULT 'CNY',
    counterparty        VARCHAR(200),
    our_party           VARCHAR(200),
    description         CLOB,
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
    initiator_id        VARCHAR(32)  NOT NULL,
    dept_id             VARCHAR(32)  NOT NULL,
    process_instance_id VARCHAR(64),
    form_key            VARCHAR(100),
    form_data           CLOB,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_categories (
    id              VARCHAR(32)  PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    code            VARCHAR(50)  NOT NULL UNIQUE,
    approval_chain  CLOB         NOT NULL,
    amount_rules    CLOB,
    form_key        VARCHAR(100),
    enabled         BOOLEAN DEFAULT TRUE,
    sort_order      INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_sessions (
    token       VARCHAR(64)  PRIMARY KEY,
    user_id     VARCHAR(32)  NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_documents (
    id              VARCHAR(32)  PRIMARY KEY,
    contract_id     VARCHAR(32)  NOT NULL,
    file_name       VARCHAR(200) NOT NULL,
    file_type       VARCHAR(20),
    file_path       VARCHAR(500) NOT NULL,
    file_size       BIGINT,
    doc_key         VARCHAR(100),
    version         INT DEFAULT 1,
    doc_type        VARCHAR(20)  DEFAULT 'body',
    uploaded_by     VARCHAR(32),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_lines (
    id              VARCHAR(32)  PRIMARY KEY,
    contract_id     VARCHAR(32)  NOT NULL,
    seq             INT          NOT NULL DEFAULT 0,
    item_name       VARCHAR(200) NOT NULL,
    specification   VARCHAR(200),
    unit            VARCHAR(20),
    quantity        DECIMAL(15,4) NOT NULL DEFAULT 1,
    unit_price      DECIMAL(15,2) NOT NULL DEFAULT 0,
    amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
    remark          VARCHAR(500),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id          VARCHAR(32)  PRIMARY KEY,
    code        VARCHAR(50)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    is_system   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id          VARCHAR(32)  PRIMARY KEY,
    code        VARCHAR(100) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    module      VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
    id          VARCHAR(32)  PRIMARY KEY,
    user_id     VARCHAR(32)  NOT NULL,
    role_id     VARCHAR(32)  NOT NULL,
    UNIQUE(user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id          VARCHAR(32)  PRIMARY KEY,
    role_id     VARCHAR(32)  NOT NULL,
    permission_id VARCHAR(32) NOT NULL,
    UNIQUE(role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

CREATE TABLE IF NOT EXISTS menu_items (
    id              VARCHAR(32)  PRIMARY KEY,
    code            VARCHAR(50)  NOT NULL UNIQUE,
    label           VARCHAR(100) NOT NULL,
    icon            VARCHAR(10),
    group_name      VARCHAR(50)  NOT NULL,
    sort_order      INT DEFAULT 0,
    link            VARCHAR(200),
    permission_code VARCHAR(100),
    is_placeholder  BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS contract_fulfillments (
    id              VARCHAR(32)  PRIMARY KEY,
    contract_id     VARCHAR(32)  NOT NULL,
    seq             INT          NOT NULL DEFAULT 0,
    type            VARCHAR(20)  NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     CLOB,
    plan_date       DATE,
    actual_date     DATE,
    amount          DECIMAL(15,2),
    status          VARCHAR(20)  NOT NULL DEFAULT 'PLANNED',
    created_by      VARCHAR(32),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
