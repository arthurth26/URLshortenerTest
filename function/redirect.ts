import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';

const supabaseURL = process.env.dbURL!
const supabaseAPIkey = process.env.apiKey!
const supabase = createClient(supabaseURL, supabaseAPIkey)


export const handler: Handler = async (event: any) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Vary': 'Origin',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({error: 'Method not allowed'})
        }
    }

    const path = event.path
    const code = path.replace(/^\/s\//, '').split('/').pop()?.trim();

    if (code === null || !/^[a-zA-Z0-9]+$/.test(code)) {
        return { statusCode: 400, body: 'invalid code' }
    }

    try{
        const { data } = await supabase.from('links').select('original_url').eq('short_code', code).single()

        if (data === null || data === undefined) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({error: `short URL not found ${code}`}) }
        }

        return {
            statusCode: 301,
            headers: { Location: `https://${data.original_url}` }
        }

    } catch (err: any) {
        console.error('Redirect error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({error: 'Internal Sever Error'})
        }
    }
    


}