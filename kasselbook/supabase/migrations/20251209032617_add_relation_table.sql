-- Create relation table
CREATE TABLE IF NOT EXISTS relation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  to_person UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('parent', 'child', 'spouse', 'sibling', 'grandparent', 'grandchild', 'aunt', 'uncle', 'niece', 'nephew', 'cousin')),
  last_edited_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  -- Prevent duplicate relationships
  CONSTRAINT unique_relation UNIQUE (from_person, to_person, relationship),
  -- Prevent self-referential relationships
  CONSTRAINT no_self_relation CHECK (from_person != to_person)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_relation_from_person ON relation (from_person);
CREATE INDEX IF NOT EXISTS idx_relation_to_person ON relation (to_person);
CREATE INDEX IF NOT EXISTS idx_relation_relationship ON relation (relationship);
CREATE INDEX IF NOT EXISTS idx_relation_last_edited_time ON relation (last_edited_time);

-- Create function to automatically update last_edited_time
CREATE OR REPLACE FUNCTION update_relation_last_edited_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_edited_time = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update last_edited_time on row update
CREATE TRIGGER trigger_update_relation_last_edited_time
  BEFORE UPDATE ON relation
  FOR EACH ROW
  EXECUTE FUNCTION update_relation_last_edited_time();

-- Create function to automatically create reverse relationships
CREATE OR REPLACE FUNCTION create_reverse_relation()
RETURNS TRIGGER AS $$
DECLARE
  reverse_relationship TEXT;
  reverse_from_person UUID;
  reverse_to_person UUID;
BEGIN
  -- Determine the reverse relationship
  CASE NEW.relationship
    WHEN 'parent' THEN
      reverse_relationship := 'child';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'child' THEN
      reverse_relationship := 'parent';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'spouse' THEN
      reverse_relationship := 'spouse';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'sibling' THEN
      reverse_relationship := 'sibling';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'grandparent' THEN
      reverse_relationship := 'grandchild';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'grandchild' THEN
      reverse_relationship := 'grandparent';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'aunt' THEN
      reverse_relationship := 'niece';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'uncle' THEN
      reverse_relationship := 'nephew';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'niece' THEN
      reverse_relationship := 'aunt';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'nephew' THEN
      reverse_relationship := 'uncle';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    WHEN 'cousin' THEN
      reverse_relationship := 'cousin';
      reverse_from_person := NEW.to_person;
      reverse_to_person := NEW.from_person;
    ELSE
      -- Unknown relationship type, don't create reverse
      RETURN NEW;
  END CASE;

  -- Only create reverse relationship if it doesn't already exist
  -- This prevents infinite loops and duplicate entries
  IF NOT EXISTS (
    SELECT 1 FROM relation
    WHERE from_person = reverse_from_person
      AND to_person = reverse_to_person
      AND relationship = reverse_relationship
  ) THEN
    INSERT INTO relation (from_person, to_person, relationship, notes)
    VALUES (reverse_from_person, reverse_to_person, reverse_relationship, NEW.notes)
    ON CONFLICT (from_person, to_person, relationship) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically create reverse relationships on insert
CREATE TRIGGER trigger_create_reverse_relation
  AFTER INSERT ON relation
  FOR EACH ROW
  EXECUTE FUNCTION create_reverse_relation();

-- Note: When you insert a relationship (e.g., "A is parent of B"), 
-- the trigger automatically creates the reverse relationship (e.g., "B is child of A").
-- This works for all relationship types including:
-- - parent <-> child
-- - spouse <-> spouse
-- - sibling <-> sibling
-- - grandparent <-> grandchild
-- - aunt/uncle <-> niece/nephew
-- - cousin <-> cousin

