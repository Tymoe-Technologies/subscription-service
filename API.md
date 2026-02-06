# Subscription Service API v2.0.0

## Design Principles

1. **Stripe-First Architecture**: Stripe is the single source of truth (SSOT) for subscriptions and billing

   - All subscription lifecycle management (create, upgrade, downgrade, trial, cancel) is completed in Stripe
   - Local database is a read-only mirror of Stripe data, updated only via webhooks
   - Subscription CRUD operations are completed through Stripe Checkout or Billing Portal

2. **Business Abstraction**: Frontend and APIs use business concepts (planKey, moduleKey), not exposing Stripe implementation details

3. **Clear Responsibilities**: This service is only responsible for:

   - ✅ Product catalog management (Plan/Module CRUD)
   - ✅ Providing Stripe entry points (Checkout/Portal Session)
   - ✅ Syncing Stripe data to local (Webhook)
   - ✅ Querying local mirror data (read-only)
   - ❌ Not responsible for direct subscription modification, billing calculation, subscription lifecycle management

4. **RESTful Style**: Use standard HTTP methods and status codes

5. **Unified Response Format**: Consistent structure for success and error responses

## Basic Information

- **Base URL**: `https://tymoe.com`
- **API Prefix**: `/api/subscription-service/v1`
- **Authentication**:
  - User API: Bearer Token (JWT)
  - Internal API: Service API Key (Header: X-Service-API-Key)
- **Content-Type**: `application/json`

## Response Format

**Success Response**:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

**Error Response**:

```json
{
  "success": false,
  "error": "error_code",
  "detail": "Error description message"
}
```

---

# 1. Subscription Management API (`/subscriptions`)

## 1.1 Create Subscription Checkout Session

**Endpoint**: `POST /api/subscription-service/v1/subscriptions/checkout`

**Description**: Create a Stripe Checkout Session, user needs to navigate to the returned URL to complete payment

**Request Headers**:

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body**:

```json
{
  "orgId": "org-uuid-123",
  "planKey": "basic_plan",
  "moduleKeys": ["appointment", "marketing"]
}
```

**Field Description**:

- `orgId` (Required, string): Organization ID (length 1-255)
- `planKey` (Required, string): Business identifier for the subscription plan (e.g., basic_plan, pro_plan, enterprise_plan)
- `moduleKeys` (Optional, string[]): Array of business identifiers for add-on modules (e.g., ["appointment", "marketing"])

**Processing Logic**:

1. Extract userId from JWT and verify permissions for orgId
2. Verify that planKey exists and status is ACTIVE
3. Verify that all moduleKeys exist and status is ACTIVE
4. Check if orgId already has an active subscription
5. Check user Trial eligibility
6. Get or create Stripe Customer
7. Build Stripe Checkout Session parameters
8. Call Stripe API to create Checkout Session
9. Log to SubscriptionLog
10. Return Checkout Session URL

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Checkout session created successfully",
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_xxx",
    "sessionId": "cs_xxx",
    "expiresAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Error Responses**:

```json
// 400 - Invalid Plan Key
{
  "success": false,
  "error": "invalid_plan_key",
  "detail": "The provided plan key does not exist or is not active"
}

// 400 - Invalid Module Key
{
  "success": false,
  "error": "invalid_module_key",
  "detail": "One or more module keys are invalid or not active"
}

// 403 - Insufficient Permissions
{
  "success": false,
  "error": "forbidden",
  "detail": "You do not have permission to manage subscriptions for this organization"
}

// 409 - Subscription Already Exists
{
  "success": false,
  "error": "subscription_exists",
  "detail": "This organization already has an active or trialing subscription"
}

// 502 - Stripe Sync Issue
{
  "success": false,
  "error": "plan_not_synced_to_stripe",
  "detail": "The plan has not been synced to Stripe yet. Please contact support."
}
```

---

## 1.2 Get Subscription Details

**Endpoint**: `GET /api/subscription-service/v1/subscriptions/:orgId`

**Description**: Get organization's subscription information (from local mirror database)

**Request Headers**:

```
Authorization: Bearer <jwt_token>
```

**Path Parameters**:

- `orgId` (string): Organization ID

**Processing Logic**:

1. Verify orgId access permission from JWT
2. Query Subscription table to get subscription information
3. Return 404 if no record found

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Subscription retrieved successfully",
  "data": {
    "orgId": "org-uuid-123",
    "status": "active",
    "items": [
      {
        "priceId": "price_basic_plan_xxx",
        "moduleKey": "basic_plan",
        "quantity": 1
      },
      {
        "priceId": "price_appointment_xxx",
        "moduleKey": "appointment",
        "quantity": 1
      }
    ],
    "stripeSubscriptionId": "sub_xxx",
    "stripeCustomerId": "cus_xxx",
    "createdAt": "2025-01-15T08:30:00.000Z",
    "updatedAt": "2025-01-15T08:30:00.000Z"
  }
}
```

---

## 1.3 Create Billing Portal Session

**Endpoint**: `POST /api/subscription-service/v1/subscriptions/:orgId/portal`

**Description**: Create a Stripe Billing Portal Session, users navigate to the returned URL to access Stripe Portal to manage subscriptions (upgrade, downgrade, add/remove modules, cancel subscription, etc.)

**Request Headers**:

```
Authorization: Bearer <jwt_token>
```

**Path Parameters**:

- `orgId` (string): Organization ID

**Request Body**: None

**Processing Logic**:

1. Verify orgId permissions
2. Query Subscription table to get stripeCustomerId
3. Return 404 if no subscription record found
4. Call Stripe API to create Billing Portal Session
5. Log to SubscriptionLog
6. Return Portal URL

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Billing portal session created successfully",
  "data": {
    "portalUrl": "https://billing.stripe.com/p/session/xxx"
  }
}
```

**Error Responses**:

```json
// 404 - Subscription Not Found
{
  "success": false,
  "error": "subscription_not_found",
  "detail": "No active subscription found for this organization"
}

// 403 - Insufficient Permissions
{
  "success": false,
  "error": "forbidden",
  "detail": "You do not have permission to manage subscriptions for this organization"
}
```

**Notes**:

- All subscription modification operations (add/remove modules, upgrade/downgrade Plan, cancel subscription) should be completed in Stripe Billing Portal
- Any operation in the Portal will trigger Webhook events, automatically syncing to the local database
- This service does not provide direct subscription modification APIs

---

# 2. Product Catalog API (`/catalog`)

> Public endpoints, no authentication required. Used by frontend to display available subscription plans and add-on modules.

## 2.1 Get All Available Plans

**Endpoint**: `GET /api/subscription-service/v1/catalog/plans`

**Description**: Get all subscription plans with status ACTIVE for users to select subscriptions

**Authentication**: No authentication required (public endpoint)

**Processing Logic**:

1. Query Plan table, filter by status = ACTIVE
2. Sort by monthlyPrice ascending
3. Return Plan list (excluding sensitive information like Stripe IDs)

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plans retrieved successfully",
  "data": {
    "plans": [
      {
        "key": "starter",
        "name": "Starter Plan",
        "description": "Entry-level plan for small businesses",
        "monthlyPrice": "99.00",
        "includedModules": [{ "moduleKey": "booking", "quantity": 1 }],
        "trialDurationDays": 14
      },
      {
        "key": "pro",
        "name": "Pro Plan",
        "description": "Professional plan for growing businesses",
        "monthlyPrice": "199.00",
        "includedModules": [
          { "moduleKey": "booking", "quantity": 1 },
          { "moduleKey": "manager", "quantity": 3 },
          { "moduleKey": "analytics", "quantity": 1 }
        ],
        "trialDurationDays": 14
      }
    ]
  }
}
```

**Field Description**:

- `key`: Business identifier for the Plan, used when creating subscriptions
- `name`: Display name of the Plan
- `description`: Plan description
- `monthlyPrice`: Monthly price (Decimal in string format)
- `includedModules`: List of modules included in the Plan
- `trialDurationDays`: Trial period in days

**Note**: Response does not include `id`, `status`, `stripePriceId`, `stripeProductId` and other internal/sensitive fields

---

## 2.2 Get Single Plan Details

**Endpoint**: `GET /api/subscription-service/v1/catalog/plans/:key`

**Description**: Get detailed information for a single Plan by Plan Key

**Authentication**: No authentication required (public endpoint)

**Path Parameters**:

- `key` (string): Business identifier for the Plan

**Processing Logic**:

1. Query Plan by key
2. Verify status = ACTIVE (Plans that are not ACTIVE are not displayed publicly)
3. Return Plan details

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plan retrieved successfully",
  "data": {
    "key": "pro",
    "name": "Pro Plan",
    "description": "Professional plan for growing businesses",
    "monthlyPrice": "199.00",
    "includedModules": [
      { "moduleKey": "booking", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 14
  }
}
```

**Error Response**:

```json
// 404 - Plan Not Found or Unavailable
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan not found or not available"
}
```

---

## 2.3 Get All Available Modules

**Endpoint**: `GET /api/subscription-service/v1/catalog/modules`

**Description**: Get all add-on modules with status ACTIVE for users to select for purchase

**Authentication**: No authentication required (public endpoint)

**Processing Logic**:

1. Query Module table, filter by status = ACTIVE
2. Sort by monthlyPrice ascending
3. Return Module list (excluding sensitive information like Stripe IDs)

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Modules retrieved successfully",
  "data": {
    "modules": [
      {
        "key": "manager",
        "name": "Manager Seats",
        "description": "Additional manager seats",
        "monthlyPrice": "20.00",
        "dependencies": [],
        "allowMultiple": true
      },
      {
        "key": "kiosk",
        "name": "Kiosk Device",
        "description": "Self-service kiosk device authorization",
        "monthlyPrice": "30.00",
        "dependencies": [],
        "allowMultiple": true
      },
      {
        "key": "analytics",
        "name": "Advanced Analytics",
        "description": "Advanced data analysis features",
        "monthlyPrice": "50.00",
        "dependencies": [],
        "allowMultiple": false
      }
    ]
  }
}
```

**Field Description**:

- `key`: Business identifier for the Module, used when creating subscriptions
- `name`: Display name of the Module
- `description`: Module description
- `monthlyPrice`: Monthly price (Decimal in string format)
- `dependencies`: Array of other module keys that this module depends on
- `allowMultiple`: Whether multiple purchases are allowed (e.g., manager seats, kiosk quantity)

**Note**: Response does not include `id`, `status`, `version`, `stripePriceId`, `stripeProductId` and other internal/sensitive fields

---

## 2.4 Get Single Module Details

**Endpoint**: `GET /api/subscription-service/v1/catalog/modules/:key`

**Description**: Get detailed information for a single Module by Module Key

**Authentication**: No authentication required (public endpoint)

**Path Parameters**:

- `key` (string): Business identifier for the Module

**Processing Logic**:

1. Query Module by key
2. Verify status = ACTIVE (Modules that are not ACTIVE are not displayed publicly)
3. Return Module details

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module retrieved successfully",
  "data": {
    "key": "analytics",
    "name": "Advanced Analytics",
    "description": "Advanced data analysis features",
    "monthlyPrice": "50.00",
    "dependencies": [],
    "allowMultiple": false
  }
}
```

**Error Response**:

```json
// 404 - Module Not Found or Unavailable
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module not found or not available"
}
```

---

# 3. Admin API (`/admin`)

## Basic Information

- **Authentication**: Admin API Key (Header: X-Admin-API-Key)
- **Purpose**: Manage product catalog (Plans and Modules), sync data to Stripe
- **Permissions**: Admin use only, requires environment variable `ADMIN_API_KEYS` configuration

---

## 3.1 Create Plan

**Endpoint**: `POST /api/subscription-service/v1/admin/plans`

**Description**: Create a new subscription plan (Plan) with optional sync to Stripe

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Request Body**:

```json
{
  "key": "standard_plan",
  "name": "Standard Plan",
  "version": "v1.0",
  "description": "Basic subscription plan with core features",
  "monthlyPrice": 199.0,
  "includedModules": [
    { "moduleKey": "appointment", "quantity": 1 },
    { "moduleKey": "member", "quantity": 1 },
    { "moduleKey": "manager", "quantity": 3 }
  ],
  "trialDurationDays": 30,
  "syncToStripe": true,
  "stripeProductId": "prod_xxxxx"
}
```

**Field Description**:

- `key` (Required, string): Business identifier for the Plan, globally unique (1-100 characters)
- `name` (Required, string): Display name of the Plan (1-255 characters)
- `version` (Required, string): Version number for the Plan, globally unique (1-255 characters)
- `description` (Optional, string): Plan description
- `monthlyPrice` (Required, number): Monthly price (Decimal 10,2)
- `includedModules` (Optional, array): List of included modules, each element contains:
  - `moduleKey` (string): Business identifier for the module
  - `quantity` (number): Quantity (default 1, allowMultiple modules can be set to a higher value)
- `trialDurationDays` (Required, number): Trial period in days (integer)
- `status` (Optional, string): Initial status of the Plan, defaults to ACTIVE (PENDING | ACTIVE | ARCHIVED)
- `syncToStripe` (Optional, boolean): Whether to immediately sync to Stripe, defaults to false
- `stripeProductId` (Optional, string): If Product is already created in Stripe, provide Product ID; otherwise auto-create

**Processing Logic**:

1. Verify Admin API Key
2. Validate request body fields (Zod schema)
3. Check if `key` already exists
4. Check if `version` already exists
5. Generate UUID as id
6. Create Plan record in database
7. If `syncToStripe=true`:
   - If `stripeProductId` not provided, call Stripe API to create Product
   - Call Stripe API to create Price (based on monthlyPrice)
   - Update returned `stripePriceId` to Plan record
8. Return created Plan information

**Success Response (201)**:

```json
{
  "success": true,
  "message": "Plan created successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "version": "v1.0",
    "description": "Basic subscription plan with core features",
    "monthlyPrice": 199.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 30,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**Error Responses**:

```json
// 401 - Invalid Admin API Key
{
  "success": false,
  "error": "invalid_admin_api_key",
  "detail": "The provided Admin API Key is invalid"
}

// 400 - Request Body Validation Failed
{
  "success": false,
  "error": "validation_error",
  "detail": "Invalid request body: key is required"
}

// 409 - Plan Key Already Exists
{
  "success": false,
  "error": "plan_key_exists",
  "detail": "A plan with this key already exists"
}

// 409 - Plan Version Already Exists
{
  "success": false,
  "error": "plan_version_exists",
  "detail": "A plan with this version already exists"
}

// 502 - Stripe Price Creation Failed
{
  "success": false,
  "error": "stripe_price_creation_failed",
  "detail": "Failed to create price in Stripe: [Stripe error message]"
}
```

---

## 3.2 Query All Plans

**Endpoint**: `GET /api/subscription-service/v1/admin/plans`

**Description**: Query all subscription plans list with filtering support

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Query Parameters**:

- `status` (Optional, string): Filter by status (ACTIVE | INACTIVE | ARCHIVED)
- `syncStatus` (Optional, string): Filter by sync status (synced | unsynced)
  - `synced`: stripePriceId is not null
  - `unsynced`: stripePriceId is null

**Processing Logic**:

1. Verify Admin API Key
2. Build query conditions (based on query parameters)
3. Query Plan table
4. Return Plan list

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plans retrieved successfully",
  "data": {
    "plans": [
      {
        "id": "uuid-xxxxx",
        "key": "standard_plan",
        "name": "Standard Plan",
        "version": "v1.0",
        "monthlyPrice": 199.0,
        "status": "ACTIVE",
        "stripePriceId": "price_1xxxxx",
        "syncedToStripe": true,
        "createdAt": "2025-11-19T12:00:00.000Z"
      },
      {
        "id": "uuid-yyyyy",
        "key": "pro_plan",
        "name": "Pro Plan",
        "version": "v1.0",
        "monthlyPrice": 499.0,
        "status": "ACTIVE",
        "stripePriceId": null,
        "syncedToStripe": false,
        "createdAt": "2025-11-18T10:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

## 3.3 Query Single Plan

**Endpoint**: `GET /api/subscription-service/v1/admin/plans/:id`

**Description**: Query detailed Plan information by ID

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Path Parameters**:

- `id` (string): UUID of the Plan

**Processing Logic**:

1. Verify Admin API Key
2. Query Plan table by id
3. Return 404 if not found
4. Return Plan details

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plan retrieved successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "version": "v1.0",
    "description": "Basic subscription plan with core features",
    "monthlyPrice": 199.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 }
    ],
    "trialDurationDays": 30,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**Error Response**:

```json
// 404 - Plan Not Found
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan with the specified ID was not found"
}
```

---

## 3.4 Update Plan

**Endpoint**: `PATCH /api/subscription-service/v1/admin/plans/:id`

**Description**: Update Plan information (excluding key)

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Path Parameters**:

- `id` (string): UUID of the Plan

**Request Body** (all fields are optional):

```json
{
  "name": "Standard Plan (Updated)",
  "version": "v1.1",
  "description": "Updated description",
  "monthlyPrice": 249.0,
  "includedModules": [
    { "moduleKey": "appointment", "quantity": 1 },
    { "moduleKey": "member", "quantity": 1 },
    { "moduleKey": "manager", "quantity": 3 }
  ],
  "trialDurationDays": 14,
  "status": "ACTIVE"
}
```

**Field Description**:

- All fields are optional, only provided fields will be updated
- **Not allowed to update**: `key`, `stripePriceId` (these fields are managed by the system)
- `version` (Optional, string): Can update version number
- `monthlyPrice` (Optional, number): If price is modified, it will automatically sync to Stripe (create new Price and deactivate old Price)
- `status` (Optional, string): Plan status (PENDING | ACTIVE | ARCHIVED | DELETED)
- `includedModules` (Optional, array): List of included modules, each element contains `moduleKey` and `quantity`

**Processing Logic**:

1. Verify Admin API Key
2. Query Plan by id
3. Return 404 if not found
4. Validate request body fields
5. Update Plan record
6. If `monthlyPrice` was modified, automatically sync to Stripe:
   - Create new Price under existing Product
   - Deactivate old Price
   - Update `stripePriceId`
7. Update `updatedAt` timestamp
8. Return updated Plan information

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plan updated successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan (Updated)",
    "version": "v1.1",
    "description": "Updated description",
    "monthlyPrice": 249.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 14,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T14:30:00.000Z"
  }
}
```

---

## 3.5 Sync Plan to Stripe

**Endpoint**: `PATCH /api/subscription-service/v1/admin/plans/:id/sync-stripe`

**Description**: Manually sync Plan to Stripe, create or update Stripe Price

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Path Parameters**:

- `id` (string): UUID of the Plan

**Request Body** (optional):

```json
{
  "stripeProductId": "prod_xxxxx",
  "forceUpdate": false
}
```

**Field Description**:

- `stripeProductId` (Optional, string): If Product is already created in Stripe, provide Product ID; otherwise auto-create
- `forceUpdate` (Optional, boolean): If Plan already has stripePriceId, whether to force create new Price (default false)

**Processing Logic**:

1. Verify Admin API Key
2. Query Plan by id
3. Return 404 if not found
4. Check if `stripePriceId` already exists:
   - If exists and `forceUpdate=false`, return 409 error
   - If exists and `forceUpdate=true`, create new Price
5. If `stripeProductId` not provided, call Stripe API to create Product
6. Call Stripe API to create Price
7. Update Plan's `stripePriceId` field
8. Update `updatedAt` timestamp
9. Return updated Plan information

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plan synced to Stripe successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "stripePriceId": "price_1xxxxx",
    "stripeProductId": "prod_xxxxx",
    "syncedAt": "2025-11-19T15:00:00.000Z"
  }
}
```

**Error Responses**:

```json
// 409 - Plan Already Synced
{
  "success": false,
  "error": "plan_already_synced",
  "detail": "Plan already has a Stripe Price ID. Use forceUpdate=true to create a new price."
}

// 502 - Stripe API Error
{
  "success": false,
  "error": "stripe_price_creation_failed",
  "detail": "Failed to create price in Stripe: Invalid API key provided"
}
```

---

## 3.6 Delete Plan (Soft Delete)

**Endpoint**: `DELETE /api/subscription-service/v1/admin/plans/:id`

**Description**: Soft delete Plan, set status to DELETED and deactivate Stripe Product

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Path Parameters**:

- `id` (string): UUID of the Plan

**Processing Logic**:

1. Verify Admin API Key
2. Query Plan by id
3. Return 404 if not found
4. If Plan has stripeProductId, call Stripe API to deactivate Product (set active=false)
5. Update Plan status to DELETED
6. Update `updatedAt` timestamp
7. Return success response

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Plan deleted successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "status": "DELETED"
  }
}
```

**Error Response**:

```json
// 404 - Plan Not Found
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan with the specified ID was not found"
}
```

**Notes**:

- This is a soft delete operation, records in the database will not be physically deleted
- Plan status will change to DELETED and will not be returned in API queries (unless explicitly filtered)
- Can be restored to ACTIVE by updating the Plan's status field

---

## 3.7 Create Module

**Endpoint**: `POST /api/subscription-service/v1/admin/modules`

**Description**: Create a new feature module (Module) with optional sync to Stripe

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Request Body**:

```json
{
  "key": "marketing",
  "name": "Marketing Module",
  "version": "v1.0",
  "description": "Marketing automation module with email and SMS marketing features",
  "monthlyPrice": 50.0,
  "dependencies": ["member"],
  "allowMultiple": true,
  "status": "ACTIVE",
  "syncToStripe": true,
  "stripeProductId": "prod_yyyyy"
}
```

**Field Description**:

- `key` (Required, string): Business identifier for the Module, globally unique (1-100 characters)
- `name` (Required, string): Display name of the Module (1-255 characters)
- `version` (Required, string): Version number for the Module, globally unique (1-255 characters)
- `description` (Optional, string): Module description
- `monthlyPrice` (Required, number): Monthly price (Decimal 10,2)
- `dependencies` (Optional, array): Array of other module keys that this module depends on, JSON format (default empty array)
- `allowMultiple` (Optional, boolean): Whether multiple purchases are allowed, defaults to false (e.g., manager/kiosk can be set to true, booking-service set to false)
- `status` (Optional, string): Initial status of the Module, defaults to ACTIVE (ACTIVE | COMING_SOON | DEPRECATED)
- `syncToStripe` (Optional, boolean): Whether to immediately sync to Stripe, defaults to false
- `stripeProductId` (Optional, string): If Product is already created in Stripe, provide Product ID; otherwise auto-create

**Processing Logic**:

1. Verify Admin API Key
2. Validate request body fields (Zod schema)
3. Check if `key` already exists
4. Check if `version` already exists
5. Verify that modules in `dependencies` exist
6. Generate UUID as id
7. Create Module record in database
8. If `syncToStripe=true`:
   - If `stripeProductId` not provided, call Stripe API to create Product
   - Call Stripe API to create Price (based on monthlyPrice)
   - Update returned `stripePriceId` to Module record
9. Return created Module information

**Success Response (201)**:

```json
{
  "success": true,
  "message": "Module created successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "version": "v1.0",
    "description": "Marketing automation module with email and SMS marketing features",
    "monthlyPrice": 50.0,
    "dependencies": ["member"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**Error Responses**:

```json
// 409 - Module Key Already Exists
{
  "success": false,
  "error": "module_key_exists",
  "detail": "A module with this key already exists"
}

// 409 - Module Version Already Exists
{
  "success": false,
  "error": "module_version_exists",
  "detail": "A module with this version already exists"
}

// 400 - Dependency Module Does Not Exist
{
  "success": false,
  "error": "invalid_module_dependency",
  "detail": "Dependency module 'member' does not exist"
}
```

---

## 3.8 Query All Modules

**Endpoint**: `GET /api/subscription-service/v1/admin/modules`

**Description**: Query all feature modules list with filtering support

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Query Parameters**:

- `status` (Optional, string): Filter by status (ACTIVE | INACTIVE | ARCHIVED)
- `syncStatus` (Optional, string): Filter by sync status (synced | unsynced)

**Processing Logic**:

1. Verify Admin API Key
2. Build query conditions (based on query parameters)
3. Query Module table
4. Return Module list

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Modules retrieved successfully",
  "data": {
    "modules": [
      {
        "id": "uuid-zzzzz",
        "key": "marketing",
        "name": "Marketing Module",
        "version": "v1.0",
        "monthlyPrice": 50.0,
        "dependencies": ["member"],
        "status": "ACTIVE",
        "stripePriceId": "price_2xxxxx",
        "syncedToStripe": true,
        "createdAt": "2025-11-19T12:00:00.000Z"
      },
      {
        "id": "uuid-aaaaa",
        "key": "analytics",
        "name": "Analytics Module",
        "version": "v1.0",
        "monthlyPrice": 80.0,
        "dependencies": [],
        "status": "ACTIVE",
        "stripePriceId": null,
        "syncedToStripe": false,
        "createdAt": "2025-11-18T10:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

## 3.9 Query Single Module

**Endpoint**: `GET /api/subscription-service/v1/admin/modules/:id`

**Description**: Query detailed Module information by ID

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Path Parameters**:

- `id` (string): UUID of the Module

**Processing Logic**:

1. Verify Admin API Key
2. Query Module table by id
3. Return 404 if not found
4. Return Module details

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module retrieved successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "version": "v1.0",
    "description": "Marketing automation module with email and SMS marketing features",
    "monthlyPrice": 50.0,
    "dependencies": ["member"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**Error Response**:

```json
// 404 - Module Not Found
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module with the specified ID was not found"
}
```

---

## 3.10 Update Module

**Endpoint**: `PATCH /api/subscription-service/v1/admin/modules/:id`

**Description**: Update Module information (excluding key)

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Path Parameters**:

- `id` (string): UUID of the Module

**Request Body** (all fields are optional):

```json
{
  "name": "Marketing Module (Enhanced)",
  "version": "v1.1",
  "description": "Enhanced marketing module",
  "monthlyPrice": 60.0,
  "dependencies": ["member", "analytics"],
  "allowMultiple": true,
  "status": "ACTIVE"
}
```

**Field Description**:

- All fields are optional, only provided fields will be updated
- **Not allowed to update**: `key`, `stripePriceId` (these fields are managed by the system)
- `version` (Optional, string): Can update version number
- `monthlyPrice` (Optional, number): If price is modified, it will automatically sync to Stripe (create new Price and deactivate old Price)
- `status` (Optional, string): Module status (ACTIVE | COMING_SOON | DEPRECATED | SUSPENDED)
- When updating `dependencies`, it will verify that dependency modules exist

**Processing Logic**:

1. Verify Admin API Key
2. Query Module by id
3. Return 404 if not found
4. Validate request body fields
5. If `dependencies` is updated, verify that dependency modules exist
6. Update Module record
7. If `monthlyPrice` was modified, automatically sync to Stripe:
   - Create new Price under existing Product
   - Deactivate old Price
   - Update `stripePriceId`
8. Update `updatedAt` timestamp
9. Return updated Module information

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module updated successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module (Enhanced)",
    "version": "v1.1",
    "description": "Enhanced marketing module",
    "monthlyPrice": 60.0,
    "dependencies": ["member", "analytics"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T16:00:00.000Z"
  }
}
```

---

## 3.11 Sync Module to Stripe

**Endpoint**: `PATCH /api/subscription-service/v1/admin/modules/:id/sync-stripe`

**Description**: Manually sync Module to Stripe, create or update Stripe Price

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**Path Parameters**:

- `id` (string): UUID of the Module

**Request Body** (optional):

```json
{
  "stripeProductId": "prod_yyyyy",
  "forceUpdate": false
}
```

**Field Description**:

- `stripeProductId` (Optional, string): If Product is already created in Stripe, provide Product ID; otherwise auto-create
- `forceUpdate` (Optional, boolean): If Module already has stripePriceId, whether to force create new Price (default false)

**Processing Logic**:

1. Verify Admin API Key
2. Query Module by id
3. Return 404 if not found
4. Check if `stripePriceId` already exists:
   - If exists and `forceUpdate=false`, return 409 error
   - If exists and `forceUpdate=true`, create new Price
5. If `stripeProductId` not provided, call Stripe API to create Product
6. Call Stripe API to create Price
7. Update Module's `stripePriceId` field
8. Update `updatedAt` timestamp
9. Return updated Module information

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module synced to Stripe successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "stripePriceId": "price_2xxxxx",
    "stripeProductId": "prod_yyyyy",
    "syncedAt": "2025-11-19T16:30:00.000Z"
  }
}
```

**Error Response**:

```json
// 409 - Module Already Synced
{
  "success": false,
  "error": "module_already_synced",
  "detail": "Module already has a Stripe Price ID. Use forceUpdate=true to create a new price."
}
```

---

## 3.12 Delete Module (Soft Delete)

**Endpoint**: `DELETE /api/subscription-service/v1/admin/modules/:id`

**Description**: Soft delete Module, set status to SUSPENDED and deactivate Stripe Product

**Request Headers**:

```
X-Admin-API-Key: <admin_api_key>
```

**Path Parameters**:

- `id` (string): UUID of the Module

**Processing Logic**:

1. Verify Admin API Key
2. Query Module by id
3. Return 404 if not found
4. If Module has stripeProductId, call Stripe API to deactivate Product (set active=false)
5. Update Module status to SUSPENDED
6. Update `updatedAt` timestamp
7. Return success response

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module deleted successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "status": "SUSPENDED"
  }
}
```

**Error Response**:

```json
// 404 - Module Not Found
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module with the specified ID was not found"
}
```

**Notes**:

- This is a soft delete operation, records in the database will not be physically deleted
- Module status will change to SUSPENDED and will not be returned in API queries (unless explicitly filtered)
- Can be restored to ACTIVE by updating the Module's status field

---

# 4. Query API (`/queries`)

## 4.1 Get Organization Subscription Details

**Endpoint**: `GET /api/subscription-service/v1/queries/orgs/:orgId/subscription`

**Description**: Get organization's complete subscription information, including subscription status, permissions list, Trial eligibility, etc.

**Request Headers**:

```
Authorization: Bearer <jwt_token>
```

**Path Parameters**:

- `orgId` (string): Organization ID

**Processing Logic**:

1. Verify JWT token
2. Extract userId from JWT
3. Verify user's access permission for orgId
4. Query Subscription table to get subscription information
5. Query UserTrialStatus table to get Trial eligibility
6. Parse planKey and moduleKeys from subscription's items field
7. Calculate permissions and feature list
8. Return complete subscription details

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Organization subscription retrieved successfully",
  "data": {
    "subscription": {
      "status": "active",
      "planKey": "pro",
      "planName": "Pro Plan",
      "moduleKeys": ["analytics", "export"],
      "trialEndsAt": null,
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "stripeSubscriptionId": "sub_xxx",
      "stripeCustomerId": "cus_xxx"
    },
    "permissions": {
      "features": ["advanced-analytics", "bulk-export", "api-access"],
      "includedModules": ["analytics", "export"]
    },
    "trial": {
      "hasUsedTrial": true,
      "canStartTrial": false,
      "trialActivatedAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

**Error Responses**:

```json
// 401 - Invalid or Expired Token
{
  "success": false,
  "error": "unauthorized",
  "detail": "Invalid or expired JWT token"
}

// 403 - No Permission
{
  "success": false,
  "error": "forbidden",
  "detail": "You don't have permission to access this organization's subscription"
}

// 404 - Subscription Not Found
{
  "success": false,
  "error": "subscription_not_found",
  "detail": "No subscription found for this organization"
}
```

---

# 5. Internal API (`/internal`)

> Internal APIs are only for calls from other microservices, requiring Service API Key authentication

## 5.1 Get Organization Module Quotas

**Endpoint**: `GET /api/subscription-service/v1/internal/org/:orgId/module-quotas`

**Description**: Get all modules and their quota quantities purchased by the organization, for internal services like auth-service to query

**Request Headers**:

```
X-Service-API-Key: <service_api_key>
```

**Path Parameters**:

- `orgId` (string): Organization ID

**Processing Logic**:

1. Verify Service API Key
2. Query Subscription table to get subscription record for the organization
3. Parse items array to extract all modules and their purchase quantities
4. Query modules included in the Plan (includedModuleKeys)
5. Merge and return complete quota list

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Module quotas retrieved successfully",
  "data": {
    "orgId": "org-uuid-123",
    "subscriptionStatus": "active",
    "planKey": "pro",
    "quotas": [
      {
        "moduleKey": "manager",
        "purchasedCount": 3,
        "allowMultiple": true,
        "source": "addon"
      },
      {
        "moduleKey": "kiosk",
        "purchasedCount": 5,
        "allowMultiple": true,
        "source": "addon"
      },
      {
        "moduleKey": "analytics",
        "purchasedCount": 1,
        "allowMultiple": false,
        "source": "plan_included"
      },
      {
        "moduleKey": "booking",
        "purchasedCount": 1,
        "allowMultiple": false,
        "source": "plan_included"
      }
    ]
  }
}
```

**Field Description**:

- `subscriptionStatus`: Subscription status (active, trialing, past_due, canceled, none)
- `planKey`: Current subscribed Plan identifier
- `quotas[].moduleKey`: Module identifier
- `quotas[].purchasedCount`: Purchased quantity
- `quotas[].allowMultiple`: Whether this module allows multiple purchases
- `quotas[].source`: Source - "plan_included" (included with Plan) or "addon" (additional purchase)

**No Subscription Response (200)**:

```json
{
  "success": true,
  "message": "No active subscription found",
  "data": {
    "orgId": "org-uuid-123",
    "subscriptionStatus": "none",
    "planKey": null,
    "quotas": []
  }
}
```

**Error Response**:

```json
// 401 - Invalid Service API Key
{
  "success": false,
  "error": "unauthorized",
  "detail": "Invalid or missing Service API Key"
}
```

---

# 6. Webhook API (`/webhooks`)

## 6.1 Stripe Webhook Processing

**Endpoint**: `POST /api/subscription-service/v1/webhooks/stripe`

**Description**: Receive and process Stripe events

**Request Headers**:

```
Stripe-Signature: t=<timestamp>,v1=<signature>
Content-Type: application/json (raw body)
```

**Processed Event Types**:

- checkout.session.completed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.payment_succeeded
- invoice.payment_failed

**Processing Logic**:

1. Verify Stripe signature
2. Check for duplicate processing (idempotency)
3. Execute corresponding processing based on event type
4. Log to WebhookEvent table
5. Return 200 OK

**Success Response (200)**:

```json
{
  "received": true
}
```

---

# Error Code Reference

| Error Code                     | HTTP | Description                                      |
| ------------------------------ | ---- | ------------------------------------------------ |
| validation_error               | 400  | Request body validation failed                   |
| invalid_plan_key               | 400  | Plan business identifier invalid or not exists   |
| invalid_module_key             | 400  | Module business identifier invalid or not exists |
| invalid_module_dependency      | 400  | Dependency module does not exist                 |
| invalid_admin_api_key          | 401  | Admin API Key invalid                            |
| forbidden                      | 403  | No permission to access this resource            |
| subscription_not_found         | 404  | Subscription does not exist                      |
| module_not_found               | 404  | Module does not exist                            |
| plan_not_found                 | 404  | Plan does not exist                              |
| subscription_exists            | 409  | Subscription already exists                      |
| plan_key_exists                | 409  | Plan Key already exists                          |
| plan_version_exists            | 409  | Plan version already exists                      |
| module_key_exists              | 409  | Module Key already exists                        |
| module_version_exists          | 409  | Module version already exists                    |
| plan_already_synced            | 409  | Plan already synced to Stripe                    |
| module_already_synced          | 409  | Module already synced to Stripe                  |
| stripe_error                   | 502  | Stripe API error                                 |
| plan_not_synced_to_stripe      | 502  | Plan not synced to Stripe                        |
| module_not_synced_to_stripe    | 502  | Module not synced to Stripe                      |
| stripe_product_creation_failed | 502  | Stripe Product creation failed                   |
| stripe_price_creation_failed   | 502  | Stripe Price creation failed                     |

---

# Database items Format

The `items` field in the Subscription table stores a JSON array of subscription items:

```json
[
  {
    "priceId": "price_basic_plan_xxx",
    "product Id": "prod_basic_plan_xxx",
    "planKey": "basic_plan",
    "quantity": 1
  },
  {
    "priceId": "price_appointment_xxx",
    "productId": "prod_appointment_xxx",
    "moduleKey": "appointment",
    "quantity": 1
  },
  {
    "priceId": "price_manager_xxx",
    "productId": "prod_manager_xxx",
    "moduleKey": "manager",
    "quantity": 3
  }
]
```

**Field Description**:

- `priceId`: Stripe Price ID
- `productId`: Stripe Product ID
- `planKey`: Business identifier for the Plan (only Plan items have this)
- `moduleKey`: Business identifier for the Module (only Module items have this)
- `quantity`: Quantity (Plan is always 1, Module can be greater than 1 based on `allowMultiple`)
