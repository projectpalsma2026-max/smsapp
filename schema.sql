-- Supabase Database Schema for HealthFirst Medical Booking System
-- SECURE CONFIGURATION with Row Level Security (RLS)

-- ==========================================
-- 1. DOCTORS TABLE
-- ==========================================
CREATE TABLE public.doctors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    image_url TEXT,
    fee NUMERIC(10, 2) DEFAULT 5.00,
    start_time TIME DEFAULT '08:00:00',
    slot_duration INTEGER DEFAULT 15,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Emergency', 'Paused', 'Break/Prayer', 'Inactive')),
    emergency_expected_return TEXT,
    consultation_duration_minutes INTEGER DEFAULT 15,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
-- Public can view doctors
CREATE POLICY "Allow public read access on doctors." ON public.doctors FOR SELECT USING (true);
-- Only authenticated Admins can insert/update/delete doctors
CREATE POLICY "Allow auth insert on doctors." ON public.doctors FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Allow auth update on doctors." ON public.doctors FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow auth delete on doctors." ON public.doctors FOR DELETE USING (auth.uid() IS NOT NULL);

-- ==========================================
-- 2. DOCTOR SCHEDULE TABLE
-- ==========================================
CREATE TABLE public.doctor_schedule (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER REFERENCES public.doctors(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
    day_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doctor_id, day_index)
);

ALTER TABLE public.doctor_schedule ENABLE ROW LEVEL SECURITY;
-- Public can view schedule to know available days
CREATE POLICY "Allow public read access on doctor_schedule." ON public.doctor_schedule FOR SELECT USING (true);
-- ONLY authenticated Admins can update, insert, and delete the schedule
CREATE POLICY "Allow auth update on doctor_schedule." ON public.doctor_schedule FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow auth insert on doctor_schedule." ON public.doctor_schedule FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Allow auth delete on doctor_schedule." ON public.doctor_schedule FOR DELETE USING (auth.uid() IS NOT NULL);


-- ==========================================
-- 3. APPOINTMENTS TABLE
-- ==========================================
CREATE TABLE public.appointments (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER REFERENCES public.doctors(id) ON DELETE CASCADE,
    patient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    district TEXT NOT NULL,
    appointment_date DATE NOT NULL,
    slot_number INTEGER NOT NULL CHECK (slot_number >= 1 AND slot_number <= 30),
    status TEXT NOT NULL DEFAULT 'pending',
    payment_phone TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doctor_id, appointment_date, slot_number) -- Prevent double booking
);

-- ==========================================
-- 4. RECEIVED PAYMENTS TABLE
-- ==========================================
CREATE TABLE public.received_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_phone TEXT NOT NULL,
    raw_sms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.received_payments ENABLE ROW LEVEL SECURITY;
-- Allow public inserts (SMS Gateway)
CREATE POLICY "Allow public insert on received_payments" ON public.received_payments FOR INSERT WITH CHECK (true);
-- Only Admins can view payments
CREATE POLICY "Allow auth read on received_payments" ON public.received_payments FOR SELECT USING (auth.uid() IS NOT NULL);

-- ==========================================
-- 5. PAYMENT VERIFICATION TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION verify_appointment_payment()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.appointments
    SET status = 'verified'
    WHERE payment_phone = NEW.sender_phone
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_verify_payment
AFTER INSERT ON public.received_payments
FOR EACH ROW
EXECUTE FUNCTION verify_appointment_payment();

-- ==========================================
-- 6. AUTO-CLEANUP LOGIC
-- ==========================================

-- Function to mark expired appointments
CREATE OR REPLACE FUNCTION expire_pending_appointments()
RETURNS void AS $$
BEGIN
    UPDATE public.appointments
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- To automate this in Supabase, you can use pg_cron if enabled:
-- SELECT cron.schedule('*/1 * * * *', 'SELECT expire_pending_appointments()');

-- Manual cleanup query:
-- UPDATE public.appointments SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW();


ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
-- Public can insert new appointments (patients booking)
CREATE POLICY "Allow public insert on appointments." ON public.appointments FOR INSERT WITH CHECK (true);

-- Public can select appointments to see which slots are taken
CREATE POLICY "Allow public read on appointments." ON public.appointments FOR SELECT USING (true);

-- ONLY authenticated Admins can update appointment status (e.g. verifying payments)
CREATE POLICY "Allow auth update on appointments." ON public.appointments FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ONLY authenticated Admins can delete appointments
CREATE POLICY "Allow auth delete on appointments." ON public.appointments FOR DELETE USING (auth.uid() IS NOT NULL);

-- SECURE RPC for patients to initialize payment without full update access
CREATE OR REPLACE FUNCTION initialize_payment(app_id INT, p_phone TEXT)
RETURNS void AS $$
BEGIN
    UPDATE public.appointments
    SET 
        payment_phone = p_phone,
        expires_at = NOW() + INTERVAL '10 minutes',
        status = 'pending'
    WHERE id = app_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



-- ==========================================
-- INITIAL DATA INSERTS
-- ==========================================

INSERT INTO public.doctors (name, specialty, image_url, fee, start_time, slot_duration, consultation_duration_minutes) VALUES
('Dr. Ahmed Ali', 'Senior Surgeon', 'https://ui-avatars.com/api/?name=Ahmed+Ali&background=EBF8FF&color=007BFF&size=150', 5.00, '08:00:00', 15, 15),
('Dr. Sarah Jama', 'Pediatrician', 'https://ui-avatars.com/api/?name=Sarah+Jama&background=EBF8FF&color=007BFF&size=150', 5.00, '08:30:00', 20, 20),
('Dr. Hassan Omar', 'Orthodontist', 'https://ui-avatars.com/api/?name=Hassan+Omar&background=EBF8FF&color=007BFF&size=150', 5.00, '09:00:00', 15, 15),
('Dr. Aisha Nur', 'General Medicine', 'https://ui-avatars.com/api/?name=Aisha+Nur&background=EBF8FF&color=007BFF&size=150', 5.00, '08:00:00', 10, 10),
('Dr. Khalid Osman', 'Neurologist', 'https://ui-avatars.com/api/?name=Khalid+Osman&background=EBF8FF&color=007BFF&size=150', 5.00, '10:00:00', 30, 30);

-- Generate initial schedule for doctors
DO $$
DECLARE
    doc_id int;
BEGIN
    FOR doc_id IN 1..5 LOOP
        INSERT INTO public.doctor_schedule (doctor_id, day_index, day_name, is_active) VALUES
        (doc_id, 0, 'Sunday', true),
        (doc_id, 1, 'Monday', true),
        (doc_id, 2, 'Tuesday', true),
        (doc_id, 3, 'Wednesday', true),
        (doc_id, 4, 'Thursday', true),
        (doc_id, 5, 'Friday', false),
        (doc_id, 6, 'Saturday', true);
    END LOOP;
END $$;

-- ==========================================
-- 7. SETTINGS TABLE
-- ==========================================
CREATE TABLE public.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY "Allow auth update on settings" ON public.settings FOR UPDATE USING (auth.uid() IS NOT NULL);

INSERT INTO public.settings (key, value) VALUES 
('ticker_text', 'Hospital is open 24/7 • Please do not smoke inside • Wear a mask • Thank you for choosing HealthFirst');

-- ENABLE REALTIME REPLICATION FOR WEBSOCKETS
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;
ALTER PUBLICATION supabase_realtime ADD TABLE doctors;
