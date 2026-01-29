# Notification System for Upcoming Events - Implementation Plan

## Overview
Build a notification system that alerts users about upcoming events (birthdays and yahrzeits) for people they've subscribed to, supporting both Hebrew and Gregorian calendars.

---

## Phase 1: Database Schema

### 1.1 Create Subscription Table
Create a migration for user subscriptions to track which people a user wants notifications for.

```sql
-- Table: subscription
- id (UUID, PK)
- user_id (UUID, FK → auth.users.id, CASCADE DELETE)
- person_id (UUID, FK → person.id, CASCADE DELETE)
- notify_birthday (BOOLEAN, DEFAULT TRUE)
- notify_yahrzeit (BOOLEAN, DEFAULT TRUE)
- created_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

-- Constraints:
- UNIQUE(user_id, person_id) - prevent duplicate subscriptions
- Indexes on user_id and person_id for fast lookups
```

### 1.2 Create Notification Preferences Table
User-level notification settings.

```sql
-- Table: notification_preference
- id (UUID, PK)
- user_id (UUID, FK → auth.users.id, CASCADE DELETE, UNIQUE)
- weekly_digest_enabled (BOOLEAN, DEFAULT TRUE)
- daily_reminder_enabled (BOOLEAN, DEFAULT TRUE)
- email_notifications (BOOLEAN, DEFAULT TRUE)
- advance_notice_days (INTEGER, DEFAULT 7) -- how many days ahead to show events
- created_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- updated_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
```

### 1.3 Create Notification Log Table (Optional)
Track sent notifications to prevent duplicates.

```sql
-- Table: notification_log
- id (UUID, PK)
- user_id (UUID, FK → auth.users.id)
- person_id (UUID, FK → person.id)
- event_type (TEXT) -- 'birthday' or 'yahrzeit'
- event_date (DATE)
- notification_type (TEXT) -- 'weekly_digest' or 'daily_reminder'
- sent_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
```

---

## Phase 2: Hebrew Calendar Integration

### 2.1 Install Hebrew Calendar Library
```bash
npm install @hebcal/core
```

### 2.2 Create Calendar Utility Module
Location: `lib/calendar/hebrew-calendar.ts`

Functions needed:
- `getHebrewDate(gregorianDate: Date, afterSunset: boolean)` - Convert Gregorian to Hebrew
- `getUpcomingHebrewAnniversary(hebrewDate, referenceDate)` - Get next occurrence of Hebrew date
- `getUpcomingGregorianAnniversary(gregorianDate, referenceDate)` - Get next birthday
- `getUpcomingYahrzeit(dateOfPassing, afterSunset, referenceDate)` - Calculate yahrzeit
- `isDateInRange(date, startDate, endDate)` - Check if date falls within range

---

## Phase 3: API Endpoints

### 3.1 Subscription Endpoints
Location: `app/api/subscriptions/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscriptions` | Get all subscriptions for current user |
| POST | `/api/subscriptions` | Subscribe to a person |
| DELETE | `/api/subscriptions/[personId]` | Unsubscribe from a person |
| PATCH | `/api/subscriptions/[personId]` | Update subscription settings |

**POST /api/subscriptions Request Body:**
```json
{
  "person_id": "uuid",
  "notify_birthday": true,
  "notify_yahrzeit": true
}
```

### 3.2 Events Endpoints
Location: `app/api/events/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/upcoming` | Get upcoming events for subscribed people |
| GET | `/api/events/today` | Get today's events |
| GET | `/api/events/week` | Get this week's events |

**GET /api/events/upcoming Query Parameters:**
- `days` (number, default: 7) - How many days ahead to look
- `type` (string) - Filter by 'birthday' or 'yahrzeit'

**Response Format:**
```json
{
  "events": [
    {
      "person_id": "uuid",
      "person_name": "string",
      "event_type": "birthday" | "yahrzeit",
      "gregorian_date": "2024-01-15",
      "hebrew_date": "5 Shevat 5784",
      "days_until": 3,
      "age": 75  // for birthdays, years since for yahrzeit
    }
  ]
}
```

### 3.3 Notification Preferences Endpoints
Location: `app/api/notifications/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications/preferences` | Get user's notification preferences |
| PUT | `/api/notifications/preferences` | Update notification preferences |

---

## Phase 4: Cron Jobs (Supabase Edge Functions)

### 4.1 Daily Event Checker
Location: `supabase/functions/daily-event-check/`

**Schedule:** Daily at 6:00 AM (configurable)

**Logic:**
1. Get all users with `daily_reminder_enabled = true`
2. For each user, fetch their subscriptions
3. Calculate today's events (Hebrew and Gregorian)
4. Send notification if events found
5. Log sent notifications

### 4.2 Weekly Digest Generator
Location: `supabase/functions/weekly-digest/`

**Schedule:** Weekly on Sunday at 8:00 AM (configurable)

**Logic:**
1. Get all users with `weekly_digest_enabled = true`
2. For each user, fetch their subscriptions
3. Calculate events for next 7 days
4. Compile digest email/notification
5. Send and log notifications

### 4.3 Cron Configuration
Using `pg_cron` in Supabase or Supabase Edge Functions with scheduled triggers.

---

## Phase 5: Frontend Pages

### 5.1 Upcoming Events Page
Location: `app/protected/events/page.tsx`

**Features:**
- Display list of upcoming events (next 7-30 days)
- Filter by event type (birthday/yahrzeit)
- Toggle between Hebrew/Gregorian date display
- Sort by date
- Quick actions (view person, unsubscribe)

**UI Components:**
- Event card with person info and date
- Date range selector
- Filter dropdown
- Empty state when no events

### 5.2 Subscriptions Management Page
Location: `app/protected/subscriptions/page.tsx`

**Features:**
- List all subscribed people
- Toggle birthday/yahrzeit notifications per person
- Bulk subscribe/unsubscribe
- Search/filter subscriptions
- Quick add from family tree

### 5.3 Notification Settings Page
Location: `app/protected/settings/notifications/page.tsx`

**Features:**
- Toggle weekly digest
- Toggle daily reminders
- Set advance notice days
- Email notification preferences

---

## Phase 6: Integration Points

### 6.1 Family Tree Integration
Add subscription button/action to person cards in the family tree view.

```typescript
// Component: SubscribeButton
// Props: personId, isSubscribed
// Actions: subscribe, unsubscribe with optimistic updates
```

### 6.2 Bulk Subscribe Feature
Allow subscribing to multiple people at once:
- All direct family members
- All ancestors
- Custom selection

---

## Implementation Order (Recommended)

### Sprint 1: Foundation
- [ ] Create database migrations (subscription, notification_preference tables)
- [ ] Install and configure @hebcal/core
- [ ] Create Hebrew calendar utility module
- [ ] Create Supabase TypeScript types

### Sprint 2: Core API
- [ ] Implement subscription CRUD endpoints
- [ ] Implement events/upcoming endpoint
- [ ] Implement notification preferences endpoints
- [ ] Add API tests

### Sprint 3: Frontend
- [ ] Create upcoming events page
- [ ] Create subscriptions management page
- [ ] Create notification settings page
- [ ] Add subscribe buttons to person views

### Sprint 4: Notifications
- [ ] Set up Supabase Edge Functions
- [ ] Implement daily event checker
- [ ] Implement weekly digest
- [ ] Configure cron schedules
- [ ] Test notification delivery

### Sprint 5: Polish & Integration
- [ ] Family tree integration
- [ ] Bulk subscribe feature
- [ ] Email templates
- [ ] Error handling and edge cases
- [ ] Performance optimization

---

## Technical Notes

### Hebrew Date Calculation
- Use `birthday_after_sunset` flag from Person table
- Yahrzeit follows specific halachic rules (different for leap years)
- Consider timezone handling for accurate sunset calculations

### Performance Considerations
- Index subscription table on user_id and person_id
- Cache Hebrew date calculations where possible
- Paginate event lists for users with many subscriptions

### Security
- All endpoints require authentication
- Users can only access their own subscriptions
- RLS policies on all tables

---

## Dependencies to Add

```json
{
  "@hebcal/core": "^5.x.x"
}
```

---

## File Structure (New Files)

```
kasselbook/
├── app/
│   ├── api/
│   │   ├── subscriptions/
│   │   │   ├── route.ts              # GET, POST subscriptions
│   │   │   └── [personId]/
│   │   │       └── route.ts          # DELETE, PATCH subscription
│   │   ├── events/
│   │   │   ├── upcoming/
│   │   │   │   └── route.ts          # GET upcoming events
│   │   │   └── today/
│   │   │       └── route.ts          # GET today's events
│   │   └── notifications/
│   │       └── preferences/
│   │           └── route.ts          # GET, PUT preferences
│   └── protected/
│       ├── events/
│       │   └── page.tsx              # Upcoming events page
│       ├── subscriptions/
│       │   └── page.tsx              # Manage subscriptions
│       └── settings/
│           └── notifications/
│               └── page.tsx          # Notification settings
├── lib/
│   └── calendar/
│       └── hebrew-calendar.ts        # Hebrew date utilities
├── components/
│   ├── events/
│   │   ├── event-card.tsx
│   │   ├── event-list.tsx
│   │   └── event-filters.tsx
│   └── subscriptions/
│       ├── subscribe-button.tsx
│       └── subscription-list.tsx
└── supabase/
    ├── migrations/
    │   ├── YYYYMMDD_add_subscription_table.sql
    │   ├── YYYYMMDD_add_notification_preference_table.sql
    │   └── YYYYMMDD_add_notification_log_table.sql
    └── functions/
        ├── daily-event-check/
        │   └── index.ts
        └── weekly-digest/
            └── index.ts
```
