-- Create person table
CREATE TABLE IF NOT EXISTS person (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  first_name TEXT NOT NULL,
  middle_names TEXT,
  maiden_name TEXT,
  last_name TEXT NOT NULL,
  gregorian_birthday DATE NOT NULL,
  birthday_after_sunset BOOLEAN NOT NULL DEFAULT FALSE, -- Based on SO: https://stackoverflow.com/a/25897040
  gregorian_date_of_passing DATE, -- Null for living persons
  date_of_passing_after_sunset BOOLEAN NOT NULL DEFAULT FALSE, -- Based on SO: https://stackoverflow.com/a/25897040
  last_edited_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);


-- Create index on gregorian_birthday for date queries
CREATE INDEX IF NOT EXISTS idx_person_gregorian_birthday ON person (gregorian_birthday);

-- Create function to automatically update last_edited_time
CREATE OR REPLACE FUNCTION update_person_last_edited_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_edited_time = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update last_edited_time on row update
CREATE TRIGGER trigger_update_person_last_edited_time
  BEFORE UPDATE ON person
  FOR EACH ROW
  EXECUTE FUNCTION update_person_last_edited_time();

-- Note: To calculate the Hebrew birthday from the Gregorian birthday, you need 
-- to know if the birthday is after sunset to adjust to the next day.
-- More context: https://stackoverflow.com/a/25897040
