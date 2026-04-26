-- 1. Create clinic_status table
CREATE TABLE IF NOT EXISTS public.clinic_status (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    doctor_id TEXT, -- Flexible to use UUID or ID string
    current_number INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create auto-update trigger for last_updated
CREATE OR REPLACE FUNCTION update_last_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clinic_status_modtime
    BEFORE UPDATE ON public.clinic_status
    FOR EACH ROW
    EXECUTE FUNCTION update_last_updated_column();

-- 3. Enable Realtime for clinic_status
-- Run this in your Supabase SQL Editor:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.clinic_status;

-- 4. Insert initial status
INSERT INTO public.clinic_status (doctor_id, current_number, is_active) 
VALUES ('global', 0, true);

-- 5. Row Level Security
ALTER TABLE public.clinic_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.clinic_status FOR SELECT USING (true);
CREATE POLICY "Allow admin update access" ON public.clinic_status FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admin insert access" ON public.clinic_status FOR INSERT WITH CHECK (auth.role() = 'authenticated');
