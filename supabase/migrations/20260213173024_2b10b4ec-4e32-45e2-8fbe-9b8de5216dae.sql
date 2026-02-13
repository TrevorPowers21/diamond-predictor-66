-- Create a storage bucket for CSV imports
INSERT INTO storage.buckets (id, name, public) VALUES ('imports', 'imports', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to imports bucket
CREATE POLICY "Staff can upload imports" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'imports' AND (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'staff'))));

-- Allow service role to read
CREATE POLICY "Service role can read imports" ON storage.objects FOR SELECT
USING (bucket_id = 'imports');