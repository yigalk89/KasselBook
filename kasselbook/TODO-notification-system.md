# Notification System for Upcoming Events - Implementation Plan

## Overview
Build a notification system that alerts users about upcoming events (birthdays, yahrzeits, anniversaries, etc.) supporting both Hebrew and Gregorian calendars. Includes both a global view of all upcoming events and personalized notifications for subscribed people.

---

## Phase 1: Database Schema

### 1.1 Create Subscription Table
Create a migration for user subscriptions to track which people a user wants notifications for.

```sql
-- Table: subscription
- id (UUID, PK)
- subscriber_user_id (UUID, FK → auth.users.id, CASCADE DELETE)  -- the user receiving notifications
- subscribed_to_person_id (UUID, FK → person.id, CASCADE DELETE) -- the person whose events trigger notifications
- notify_birthday (BOOLEAN, DEFAULT TRUE)
- notify_yahrzeit (BOOLEAN, DEFAULT TRUE)
- notify_anniversary (BOOLEAN, DEFAULT TRUE)
- created_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

-- Constraints:
- UNIQUE(subscriber_user_id, subscribed_to_person_id) - prevent duplicate subscriptions
- Indexes on subscriber_user_id and subscribed_to_person_id for fast lookups
```

### 1.2 Create Notification Preferences Table
User-level notification and display settings.

```sql
-- Table: notification_preference
- id (UUID, PK)
- user_id (UUID, FK → auth.users.id, CASCADE DELETE, UNIQUE)
- weekly_digest_enabled (BOOLEAN, DEFAULT TRUE)
- daily_reminder_enabled (BOOLEAN, DEFAULT TRUE)
- email_notifications (BOOLEAN, DEFAULT TRUE)
- advance_notice_days (INTEGER, DEFAULT 7) -- how many days ahead for notifications
- default_events_period (TEXT, DEFAULT 'this_week') -- default period for events page
- created_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- updated_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

-- Note: Weeks start on Sunday
```

### 1.3 Create Custom Events Table
Store custom events like anniversaries, bar/bat mitzvahs, or other recurring dates.

```sql
-- Table: custom_event
- id (UUID, PK)
- person_id (UUID, FK → person.id, CASCADE DELETE)  -- primary person associated with event
- related_person_id (UUID, FK → person.id, nullable) -- optional second person (e.g., spouse for anniversary)
- event_type (TEXT, NOT NULL) -- 'anniversary', 'bar_mitzvah', 'aliyah', 'other'
- event_name (TEXT) -- custom display name, e.g., "Wedding Anniversary"
- gregorian_date (DATE, NOT NULL)
- date_after_sunset (BOOLEAN, DEFAULT FALSE) -- for Hebrew date calculation
- notes (TEXT)
- created_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

-- Indexes on person_id and event_type
```

### 1.4 Create Notification Log Table (Optional)
Track sent notifications to prevent duplicates.

```sql
-- Table: notification_log
- id (UUID, PK)
- user_id (UUID, FK → auth.users.id)
- person_id (UUID, FK → person.id)
- event_type (TEXT) -- 'birthday', 'yahrzeit', 'anniversary', etc.
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

**Hebrew Date Functions:**
- `getHebrewDate(gregorianDate: Date, afterSunset: boolean)` - Convert Gregorian to Hebrew
- `getUpcomingHebrewAnniversary(hebrewDate, referenceDate)` - Get next occurrence of Hebrew date
- `getUpcomingGregorianAnniversary(gregorianDate, referenceDate)` - Get next birthday/anniversary
- `getUpcomingYahrzeit(dateOfPassing, afterSunset, referenceDate)` - Calculate yahrzeit
- `getUpcomingEventDate(eventDate, afterSunset, referenceDate)` - Generic function for any recurring event
- `isDateInRange(date, startDate, endDate)` - Check if date falls within range
- `calculateYearsSince(originalDate, currentDate)` - Calculate years for display (age, years married, etc.)

### 2.3 Create Period Utility Module
Location: `lib/calendar/period-utils.ts`

**Period Resolution Functions:**
- `getPeriodDateRange(period: string, today: Date)` - Convert period name to date range
- `getWeekRange(date: Date)` - Get Sunday-Saturday range for given date
- `getHebrewMonthRange(date: Date)` - Get Hebrew month start/end dates

```typescript
type Period = 'this_week' | 'next_week' | 'this_month' | 'next_month'
            | 'this_hebrew_month' | 'next_hebrew_month' | 'custom';

interface DateRange {
  start: Date;
  end: Date;
  hebrewStart?: string;  // formatted Hebrew date
  hebrewEnd?: string;
}

function getPeriodDateRange(period: Period, today: Date): DateRange {
  switch (period) {
    case 'this_week':
      return getWeekRange(today);  // Sunday-Saturday
    case 'next_week':
      return getWeekRange(addWeeks(today, 1));
    case 'this_month':
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case 'next_month':
      const nextMonth = addMonths(today, 1);
      return { start: startOfMonth(nextMonth), end: endOfMonth(nextMonth) };
    case 'this_hebrew_month':
      return getHebrewMonthRange(today);
    case 'next_hebrew_month':
      return getHebrewMonthRange(getNextHebrewMonth(today));
  }
}
```

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
| GET | `/api/events/all` | Get ALL upcoming events (global view, regardless of subscriptions) |
| GET | `/api/events/subscribed` | Get upcoming events only for people user is subscribed to |

**Query Parameters (Calendar-Based Periods):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | Time period to query (see below). Default: user's preference or `this_week` |
| `start_date` | date | Start date for custom period (requires `period=custom`) |
| `end_date` | date | End date for custom period (requires `period=custom`) |
| `type` | string | Filter by event type: `birthday`, `yahrzeit`, `anniversary`, etc. |

**Supported Periods:**

| Period | Description |
|--------|-------------|
| `this_week` | Current week (Sunday-Saturday) |
| `next_week` | Following week |
| `this_month` | Current calendar month |
| `next_month` | Following calendar month |
| `this_hebrew_month` | Current Hebrew month |
| `next_hebrew_month` | Following Hebrew month |
| `custom` | Custom date range using `start_date` and `end_date` |

**Example Requests:**
```
GET /api/events/all?period=this_week
GET /api/events/subscribed?period=next_month
GET /api/events/all?period=custom&start_date=2024-01-15&end_date=2024-02-15
```

**Response Format:**
```json
{
  "period": "this_month",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31",
    "hebrew_start": "20 Tevet 5784",
    "hebrew_end": "21 Shevat 5784"
  },
  "events": [
    {
      "person_id": "uuid",
      "person_name": "string",
      "event_type": "birthday" | "yahrzeit" | "anniversary" | "other",
      "event_name": "string",  // e.g., "Birthday" or "Wedding Anniversary"
      "gregorian_date": "2024-01-15",
      "hebrew_date": "5 Shevat 5784",
      "days_until": 3,
      "years": 75,  // age for birthdays, years since for yahrzeit, years married for anniversary
      "is_subscribed": true  // helpful for global view to show subscription status
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

### 5.1 Upcoming Events Pages
Location: `app/protected/events/page.tsx`

**Two Views:**
1. **All Events** (`/protected/events/all`) - Shows ALL upcoming events in the database
2. **My Events** (`/protected/events`) - Shows only events for subscribed people

**Features:**
- Toggle between "All Events" and "My Events" views
- Display list of upcoming events (next 7-30 days)
- Filter by event type (birthday/yahrzeit/anniversary)
- Toggle between Hebrew/Gregorian date display
- Sort by date
- Quick actions (view person, subscribe/unsubscribe)
- In "All Events" view, show subscription status with quick subscribe button

**UI Components:**
- Event card with person info and date
- View toggle (All / My Events)
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
- [ ] Create database migrations (subscription, notification_preference, custom_event tables)
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
  "@hebcal/core": "^5.x.x",
  "date-fns": "^3.x.x"
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
│   │   │   ├── all/
│   │   │   │   └── route.ts          # GET all upcoming events (global)
│   │   │   ├── subscribed/
│   │   │   │   └── route.ts          # GET events for subscribed people
│   │   │   └── today/
│   │   │       └── route.ts          # GET today's events
│   │   └── notifications/
│   │       └── preferences/
│   │           └── route.ts          # GET, PUT preferences
│   └── protected/
│       ├── events/
│       │   ├── page.tsx              # My subscribed events page
│       │   └── all/
│       │       └── page.tsx          # All events page (global view)
│       ├── subscriptions/
│       │   └── page.tsx              # Manage subscriptions
│       └── settings/
│           └── notifications/
│               └── page.tsx          # Notification settings
├── lib/
│   └── calendar/
│       ├── hebrew-calendar.ts        # Hebrew date utilities
│       └── period-utils.ts           # Calendar period resolution (this_week, etc.)
├── components/
│   ├── events/
│   │   ├── event-card.tsx
│   │   ├── event-list.tsx
│   │   ├── event-filters.tsx
│   │   └── events-view-toggle.tsx    # Toggle between All/My Events
│   └── subscriptions/
│       ├── subscribe-button.tsx
│       └── subscription-list.tsx
└── supabase/
    ├── migrations/
    │   ├── YYYYMMDD_add_subscription_table.sql
    │   ├── YYYYMMDD_add_custom_event_table.sql
    │   ├── YYYYMMDD_add_notification_preference_table.sql
    │   └── YYYYMMDD_add_notification_log_table.sql
    └── functions/
        ├── daily-event-check/
        │   └── index.ts
        └── weekly-digest/
            └── index.ts
```
