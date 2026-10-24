ALTER TABLE demo_control DROP CONSTRAINT IF EXISTS demo_control_frequency_check;
ALTER TABLE demo_control DROP CONSTRAINT IF EXISTS demo_control_frequency_check1;
ALTER TABLE demo_control ADD CONSTRAINT demo_control_frequency_check CHECK(frequency IN('SIGNAL','HOURLY','QUICK'));
