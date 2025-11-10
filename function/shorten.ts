import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import crypto from 'crypto';

const dbURL = process.env.dbURL;
const apiKey = process.env.apiKey;

const supabase = createClient(dbURL!, apiKey!)

function hash(url: string, attempt: number): string {
    const normalize = url.trim().toLowerCase()
    const salt = new Date().getMonth() * new Date().getFullYear() - new Date().getSeconds() + Math.random()
    const data = `${normalize}${salt}${attempt}`
    const hash = crypto.createHash('sha256').update(data, 'utf-8')
    const digest = hash.digest('hex').slice(0, 10)
    return digest
}

function isValidUrl(url: string): boolean {
    try {
        const { protocol } = new URL(url);
        return ['http:', 'https:'].includes(protocol)
    } catch {
        return false
    }
}

async function checkURLinDB(code: string): Promise<boolean> {
    const { data, error } = await supabase.from('links').select('id').eq('short_code', code).maybeSingle()

    if (error && error.code !== 'PGRST116') {
        return false
    } else {
        return !!data
    }
}


export const handler: Handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Vary': 'Origin',
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let url: string
    try {
        const body = JSON.parse(event.body ?? '{}')
        url = body.url
    } catch {
        return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid JSON' })
        }
    }

    if (!url || typeof url !== 'string') {
        return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'URL is required' }),
        };
    }

    if (isValidUrl(url) === false) {
        return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Need proper URL' })
        }
    }

    try {
        const { data: existing } = await supabase.from('links').select('short_code').eq('original_url', url).maybeSingle()

        if (existing !== null || existing !== undefined) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shortURL: `https://notveryshort.netlify.app/${existing!.short_code}`
                })
            }
        }

        for (let i = 0; i < 5; i++) {
            const shortCode = hash(url, i)

            if ((await checkURLinDB(shortCode)) === false) {
                const { error } = await supabase.from('links').insert({ short_code: shortCode, original_url: url })

                if (error !== null || error !== undefined) { throw error }

                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'Application/JSON' },
                    body: JSON.stringify({
                        shortURL: `https://notveryshort.netlify.app/${shortCode}`
                    })
                }
            }
        }

        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'failed to generate unique code' })
        }
    } catch (err) {
        console.error('Shortener error:', err)
    } return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'Application/json' },
        body: JSON.stringify({ error: 'Internal Server Error' })
    }
}


