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

### 1.4 Create Upcoming Event Table (Materialized Cache)
Pre-computed table storing calculated upcoming events. Refreshed daily by cron job.

```sql
-- Table: upcoming_event
- id (UUID, PK)

-- Source references
- person_id (UUID, FK → person.id, CASCADE DELETE, NOT NULL)
- related_person_id (UUID, FK → person.id, CASCADE DELETE, nullable) -- for anniversaries
- custom_event_id (UUID, FK → custom_event.id, CASCADE DELETE, nullable) -- if from custom_event

-- Event details
- event_type (TEXT, NOT NULL) -- 'birthday', 'yahrzeit', 'anniversary', etc.
- event_name (TEXT, NOT NULL) -- "David's Birthday", "Sarah's Yahrzeit"

-- Calculated dates (for the upcoming occurrence)
- event_gregorian_date (DATE, NOT NULL) -- when it occurs this year
- event_hebrew_date (TEXT, NOT NULL)    -- formatted: "15 Shevat 5785"

-- Context
- original_date (DATE, NOT NULL)        -- original event date (for calculating years)
- years (INTEGER)                       -- age, years since passing, years married

-- Metadata
- calculated_at (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

-- Constraints & Indexes
- UNIQUE(person_id, event_type, event_gregorian_date) -- prevent duplicates
- INDEX on event_gregorian_date (primary query filter)
- INDEX on person_id
- INDEX on event_type
```

### 1.5 Create Notification Log Table (Optional)
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

### 2.4 Create Event Calculation Module
Location: `lib/calendar/event-calculations.ts`

Core functions for calculating upcoming event dates.

```typescript
import { HDate, HebrewCalendar } from '@hebcal/core';

interface UpcomingEvent {
  gregorianDate: Date;
  hebrewDate: string;
  years: number;
}

/**
 * Calculate the next birthday occurrence (Hebrew calendar)
 */
function calculateUpcomingBirthday(
  birthDate: Date,
  afterSunset: boolean,
  today: Date,
  endDate: Date
): UpcomingEvent | null {
  // Convert birth date to Hebrew
  const hebrewBirthDate = new HDate(birthDate);
  if (afterSunset) hebrewBirthDate.next();

  const currentHebrewYear = new HDate(today).getFullYear();

  // Check this year and next year
  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const targetYear = currentHebrewYear + yearOffset;
    const nextOccurrence = new HDate(
      hebrewBirthDate.getDate(),
      hebrewBirthDate.getMonth(),
      targetYear
    );

    const gregorianDate = nextOccurrence.greg();
    if (gregorianDate >= today && gregorianDate <= endDate) {
      return {
        gregorianDate,
        hebrewDate: nextOccurrence.render('en'),
        years: targetYear - hebrewBirthDate.getFullYear()
      };
    }
  }
  return null;
}

/**
 * Calculate the next yahrzeit occurrence
 * Uses hebcal's built-in yahrzeit calculation (handles leap year rules)
 */
function calculateUpcomingYahrzeit(
  deathDate: Date,
  afterSunset: boolean,
  today: Date,
  endDate: Date
): UpcomingEvent | null {
  const hebrewDeathDate = new HDate(deathDate);
  if (afterSunset) hebrewDeathDate.next();

  const currentHebrewYear = new HDate(today).getFullYear();

  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const targetYear = currentHebrewYear + yearOffset;
    const yahrzeit = HebrewCalendar.getYahrzeit(targetYear, hebrewDeathDate);

    if (yahrzeit) {
      const gregorianDate = yahrzeit.greg();
      if (gregorianDate >= today && gregorianDate <= endDate) {
        return {
          gregorianDate,
          hebrewDate: yahrzeit.render('en'),
          years: targetYear - hebrewDeathDate.getFullYear()
        };
      }
    }
  }
  return null;
}

/**
 * Calculate upcoming date for custom events (anniversaries, etc.)
 */
function calculateUpcomingCustomEvent(
  eventDate: Date,
  afterSunset: boolean,
  today: Date,
  endDate: Date
): UpcomingEvent | null {
  // Same logic as birthday - find next Hebrew calendar occurrence
  return calculateUpcomingBirthday(eventDate, afterSunset, today, endDate);
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

### 4.1 Refresh Upcoming Events Job (Core Job)
Location: `supabase/functions/refresh-upcoming-events/`

**Schedule:** Daily at 2:00 AM

**Purpose:** Populate/refresh the `upcoming_event` table with pre-calculated events.

**Logic:**
```typescript
async function refreshUpcomingEvents() {
  const today = new Date();
  const lookAheadMonths = 3;  // Calculate 3 months ahead
  const endDate = addMonths(today, lookAheadMonths);

  // 1. Clear past events
  await supabase
    .from('upcoming_event')
    .delete()
    .lt('event_gregorian_date', today);

  // 2. Fetch all people
  const { data: people } = await supabase
    .from('person')
    .select('*');

  const eventsToInsert = [];

  for (const person of people) {
    // 3a. Calculate upcoming birthday
    const birthday = calculateUpcomingBirthday(
      person.gregorian_birthday,
      person.birthday_after_sunset,
      today, endDate
    );
    if (birthday) {
      eventsToInsert.push({
        person_id: person.id,
        event_type: 'birthday',
        event_name: `${person.first_name}'s Birthday`,
        event_gregorian_date: birthday.gregorianDate,
        event_hebrew_date: birthday.hebrewDate,
        original_date: person.gregorian_birthday,
        years: birthday.years
      });
    }

    // 3b. Calculate upcoming yahrzeit (if deceased)
    if (person.gregorian_date_of_passing) {
      const yahrzeit = calculateUpcomingYahrzeit(
        person.gregorian_date_of_passing,
        person.date_of_passing_after_sunset,
        today, endDate
      );
      if (yahrzeit) {
        eventsToInsert.push({
          person_id: person.id,
          event_type: 'yahrzeit',
          event_name: `${person.first_name}'s Yahrzeit`,
          event_gregorian_date: yahrzeit.gregorianDate,
          event_hebrew_date: yahrzeit.hebrewDate,
          original_date: person.gregorian_date_of_passing,
          years: yahrzeit.years
        });
      }
    }
  }

  // 4. Process custom events (anniversaries, etc.)
  const { data: customEvents } = await supabase
    .from('custom_event')
    .select('*, person:person_id(first_name)');

  for (const event of customEvents) {
    const upcoming = calculateUpcomingCustomEvent(
      event.gregorian_date,
      event.date_after_sunset,
      today, endDate
    );
    if (upcoming) {
      eventsToInsert.push({
        person_id: event.person_id,
        related_person_id: event.related_person_id,
        custom_event_id: event.id,
        event_type: event.event_type,
        event_name: event.event_name || `${event.person.first_name}'s ${event.event_type}`,
        event_gregorian_date: upcoming.gregorianDate,
        event_hebrew_date: upcoming.hebrewDate,
        original_date: event.gregorian_date,
        years: upcoming.years
      });
    }
  }

  // 5. Upsert all events
  await supabase
    .from('upcoming_event')
    .upsert(eventsToInsert, {
      onConflict: 'person_id,event_type,event_gregorian_date'
    });
}
```

### 4.2 Daily Event Checker (Notifications)
Location: `supabase/functions/daily-event-check/`

**Schedule:** Daily at 6:00 AM (after refresh job)

**Logic:**
1. Get all users with `daily_reminder_enabled = true`
2. For each user, fetch their subscriptions
3. Query `upcoming_event` table for today's events matching subscribed people
4. Send notification if events found
5. Log sent notifications

### 4.3 Weekly Digest Generator
Location: `supabase/functions/weekly-digest/`

**Schedule:** Weekly on Sunday at 8:00 AM

**Logic:**
1. Get all users with `weekly_digest_enabled = true`
2. For each user, fetch their subscriptions
3. Query `upcoming_event` table for next 7 days matching subscribed people
4. Compile digest email/notification
5. Send and log notifications

### 4.4 Cron Configuration
Using `pg_cron` in Supabase or Supabase Edge Functions with scheduled triggers.

```sql
-- Example pg_cron setup
SELECT cron.schedule('refresh-events', '0 2 * * *', 'SELECT refresh_upcoming_events()');
SELECT cron.schedule('daily-check', '0 6 * * *', 'SELECT send_daily_notifications()');
SELECT cron.schedule('weekly-digest', '0 8 * * 0', 'SELECT send_weekly_digest()');
```

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
- [ ] Create database migrations (subscription, notification_preference, custom_event, upcoming_event tables)
- [ ] Install and configure @hebcal/core and date-fns
- [ ] Create Hebrew calendar utility module
- [ ] Create period utility module
- [ ] Create event calculation module
- [ ] Create Supabase TypeScript types

### Sprint 2: Core API & Event Refresh
- [ ] Implement refresh-upcoming-events Edge Function
- [ ] Implement subscription CRUD endpoints
- [ ] Implement events/all endpoint (reads from upcoming_event table)
- [ ] Implement events/subscribed endpoint
- [ ] Implement notification preferences endpoints
- [ ] Add API tests

### Sprint 3: Frontend
- [ ] Create upcoming events page (with period selector)
- [ ] Create subscriptions management page
- [ ] Create notification settings page
- [ ] Add subscribe buttons to person views

### Sprint 4: Notifications
- [ ] Set up Supabase Edge Functions cron triggers
- [ ] Implement daily event checker (reads from upcoming_event)
- [ ] Implement weekly digest (reads from upcoming_event)
- [ ] Configure cron schedules (refresh at 2 AM, daily at 6 AM, weekly Sunday 8 AM)
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
│       ├── period-utils.ts           # Calendar period resolution (this_week, etc.)
│       └── event-calculations.ts     # Birthday, yahrzeit, anniversary calculations
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
    │   ├── YYYYMMDD_add_upcoming_event_table.sql   # Pre-computed events cache
    │   └── YYYYMMDD_add_notification_log_table.sql
    └── functions/
        ├── refresh-upcoming-events/  # Daily 2 AM - populates upcoming_event table
        │   └── index.ts
        ├── daily-event-check/        # Daily 6 AM - sends notifications
        │   └── index.ts
        └── weekly-digest/            # Sunday 8 AM - sends weekly summary
            └── index.ts
```
