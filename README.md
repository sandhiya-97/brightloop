# Subscription Management System

A web-based platform to manage products, plans, subscriptions, invoices, payments and revenue reports for Brightloop Software. Built from scratch with our own REST API and a local PostgreSQL database.

## Features
- **Auth and roles:** signup, login, password reset by email; Admin, Staff and Customer roles
- **Products and plans:** variants (e.g. brand price extras), billing periods (daily/weekly/monthly/yearly)
- **Subscriptions:** quotation templates, status flow Draft → Quotation → Confirmed → Active → Closed
- **Invoicing:** auto-generated from subscriptions, with taxes and no double billing
- **Discounts:** fixed or percentage, applied automatically
- **Payments:** recorded against invoices, with paid, outstanding and overdue views
- **Finance dashboard:** active subscriptions, revenue, payments and overdue invoices
- **Customer portal:** customers see only their own subscriptions and invoices

## Tech Stack
- Frontend: React
- Backend: Node.js, Express
- Database: PostgreSQL (local)
- Auth: JWT, bcrypt

## Project Structure
```
backend/   routes, controllers, services, models, middleware
frontend/  components, pages
database/  schema, migrations, seed data
```

## Setup
1. Clone the repo
   `git clone https://github.com/sandhiya-97/bill_67.git`
2. Create the database in PostgreSQL: `CREATE DATABASE subscription_db;`
3. Copy `.env.example` to `.env` and fill in your values
4. Install and run the backend
   `cd backend && npm install && npm run migrate && npm run seed && npm start`
5. Install and run the frontend
   `cd frontend && npm install && npm start`

## Demo Accounts
| Role | Email | Password |
|------|-------|----------|
| Admin | [email] | [password] |
| Staff | [email] | [password] |
| Customer | [email] | [password] |

## Team
| Name | GitHub | Module |
|------|--------|--------|
| [Name] | [@username] | Auth and security |
| [Name] | [@username] | Products, plans, discounts |
| [Name] | [@username] | Subscriptions and invoices |
| [Name] | [@username] | Payments, dashboard, portal |

## Demo Video
[link]
