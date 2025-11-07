import { createClient } from '@supabase/supabase-js';

const supabaseURL = process.env.dbURL!
const supabaseAPIkey = process.env.apiKey!
const supabase = createClient(supabaseURL, supabaseAPIkey)

export async function handler(event: any) {
    const code = event.path.split('/').pop();

    if (code === null || !/^[a-zA-Z0-9]{6,}$/.test(code)) {
        return { statusCode: 400, body: 'invalid code' }
    }

    const { data } = await supabase.from('links').select('original_url').eq('short_code', code).single()

    if (data === null || data === undefined) {
        return { statusCode: 404, body: 'Not found' }
    }

    return {
        statusCode: 301,
        headers: { Location: data.original_url }
    }
}