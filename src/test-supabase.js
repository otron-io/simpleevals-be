require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  const { data, error } = await supabase.from('evaluations').select('*').limit(1);
  if (error) {
    console.error('Supabase connection error:', error);
    process.exit(1);
  } else {
    console.log('Supabase connection successful! Sample data:', data);
    process.exit(0);
  }
}

testConnection(); 