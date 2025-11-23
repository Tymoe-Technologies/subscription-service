# Subscription Service

A Stripe-integrated subscription management microservice for managing Plans, Modules, subscriptions, and billing.

## Overview

This service provides a complete subscription lifecycle management system built on Stripe's payment infrastructure. It handles:

- **Product Catalog Management**: Define and manage subscription Plans and add-on Modules
- **Subscription Creation**: Create Stripe Checkout sessions for new subscriptions
- **Billing Portal**: Provide customers access to Stripe Billing Portal for self-service management
- **Webhook Processing**: Synchronize Stripe events to local database
- **Query APIs**: Retrieve subscription details and module quotas
- **Internal APIs**: Provide subscription data to other microservices

## Architecture

### Core Design Principles

1. **Stripe-First**: Stripe is the single source of truth for subscriptions
   - All subscription lifecycle operations (create, upgrade, downgrade, cancel) happen in Stripe
   - Local database is a read-only mirror, updated only via webhooks
2. **Business Abstraction**: APIs use business concepts (planKey, moduleKey) instead of Stripe IDs

3. **RESTful Design**: Standard HTTP methods and status codes

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis
- **Payment**: Stripe API
- **Authentication**: JWT (user APIs), API Key (admin/internal APIs)

## Project Structure

```
src/
├── api/v1/
│   ├── subscriptions/     # User subscription APIs
│   ├── catalog/           # Public product catalog APIs
│   ├── admin/             # Admin management APIs
│   │   ├── plans/         # Plan CRUD operations
│   │   └── modules/       # Module CRUD operations
│   ├── queries/           # Subscription query APIs
│   ├── internal/          # Inter-service APIs
│   └── webhooks/          # Stripe webhook handlers
├── middleware/            # Authentication and validation
├── types/                 # TypeScript type definitions
├── utils/                 # Utilities and helpers
├── validators/            # Request validation schemas
├── infra/                 # Infrastructure clients
│   ├── prisma.ts         # Database client
│   ├── stripe.ts         # Stripe client
│   └── redis.ts          # Redis client
└── config/               # Configuration
```

## API Overview

### Base URL

- Development: `http://localhost:8088/api/subscription-service/v1`
- Production: `https://api.tymoe.com/api/subscription-service/v1`

### API Categories

#### 1. Subscription APIs (`/subscriptions`)

Create and manage user subscriptions

- `POST /subscriptions/checkout` - Create Stripe Checkout session
- `GET /subscriptions/:orgId` - Get subscription details
- `POST /subscriptions/:orgId/portal` - Create Billing Portal session

#### 2. Catalog APIs (`/catalog`)

Public product catalog (no authentication required)

- `GET /catalog/plans` - List all active plans
- `GET /catalog/plans/:key` - Get plan details
- `GET /catalog/modules` - List all active modules
- `GET /catalog/modules/:key` - Get module details

#### 3. Admin APIs (`/admin`)

Manage Plans and Modules (Admin API Key required)

- **Plans**: `GET|POST|PATCH|DELETE /admin/plans`
- **Modules**: `GET|POST|PATCH|DELETE /admin/modules`
- **Sync to Stripe**: `PATCH /admin/plans/:id/sync-stripe`

#### 4. Query APIs (`/queries`)

Query subscription information

- `GET /queries/orgs/:orgId/subscription` - Get organization subscription details

#### 5. Internal APIs (`/internal`)

Inter-service communication (Service API Key required)

- `GET /internal/org/:orgId/module-quotas` - Get module quotas for an organization

#### 6. Webhook APIs (`/webhooks`)

Stripe event processing

- `POST /webhooks/stripe` - Stripe webhook endpoint

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Stripe account

### Installation

```bash
# Clone repository
git clone <repository-url>
cd subscription-service

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/subscription_db

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Authentication
JWT_SECRET=your-jwt-secret

# API Keys
ADMIN_API_KEYS=admin-key-1,admin-key-2
INTERNAL_API_KEY=internal-service-key

# Server
PORT=8088
NODE_ENV=development
```

### Local Stripe Webhook Setup

For local development, use Stripe CLI to forward webhooks:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe

# Copy the webhook signing secret and update .env
# STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

## Database Schema

### Core Tables

- **plans** - Subscription plans (Basic, Pro, Enterprise)
- **modules** - Add-on modules (Manager seats, Kiosk devices, Analytics)
- **subscriptions** - Customer subscriptions
- **webhook_events** - Stripe webhook event log
- **subscription_logs** - Subscription operation audit log
- **user_trial_status** - Trial usage tracking

### Key Relationships

```
Organization --< Subscription --> Plan
Subscription --< SubscriptionItems --> Modules
```

## Usage Examples

### 1. Create a Checkout Session (User API)

```typescript
POST /api/subscription-service/v1/subscriptions/checkout
Headers: Authorization: Bearer <jwt_token>
Body:
{
  "orgId": "org-uuid-123",
  "planKey": "pro",
  "moduleKeys": ["analytics", "export"]
}

Response:
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_xxx",
    "sessionId": "cs_xxx"
  }
}
```

### 2. Get Product Catalog (Public API)

```typescript
GET /api/subscription-service/v1/catalog/plans

Response:
{
  "success": true,
  "data": {
    "plans": [
      {
        "key": "basic",
        "name": "Basic Plan",
        "monthlyPrice": "99.00",
        "includedModules": [...]
      }
    ]
  }
}
```

### 3. Create a Plan (Admin API)

```typescript
POST /api/subscription-service/v1/admin/plans
Headers: X-Admin-API-Key: <admin_key>
Body:
{
  "key": "enterprise",
  "name": "Enterprise Plan",
  "monthlyPrice": 999.00,
  "includedModules": [
    { "moduleKey": "booking", "quantity": 1 },
    { "moduleKey": "manager", "quantity": 10 }
  ],
  "syncToStripe": true
}
```

### 4. Get Module Quotas (Internal API)

```typescript
GET /api/subscription-service/v1/internal/org/org-123/module-quotas
Headers: X-Service-API-Key: <service_key>

Response:
{
  "success": true,
  "data": {
    "orgId": "org-123",
    "subscriptionStatus": "active",
    "quotas": [
      {
        "moduleKey": "manager",
        "purchasedCount": 5,
        "allowMultiple": true,
        "source": "addon"
      }
    ]
  }
}
```

## Development

### Run Tests

```bash
npm test
```

### Database Management

```bash
# Create migration
npx prisma migrate dev --name description

# Reset database
npx prisma migrate reset

# Generate Prisma Client
npx prisma generate

# Open Prisma Studio
npx prisma studio
```

### Linting and Formatting

```bash
npm run lint
npm run format
```

## Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
EXPOSE 8088
CMD ["npm", "start"]
```

### Environment Setup

1. Set up production database (PostgreSQL)
2. Configure Redis instance
3. Add Stripe webhook endpoint in Stripe Dashboard
4. Set environment variables in deployment platform

## API Documentation

Detailed API documentation is available in [API.md](./API.md).

## License

Proprietary - Tymoe Inc.

## Support

For issues and questions, contact the Tymoe Engineering team.

```

```
