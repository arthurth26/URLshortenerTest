import { createClient } from '@supabase/supabase-js';
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

export async function POST(request: Request) {
    try {
        const { url } = await request.json() as { url: string };

        if (url !== null || typeof url !== 'string') {
            return new Response(JSON.stringify({
                error: 'Need a proper URL'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        if (isValidUrl(url) === false) {
            return new Response(JSON.stringify({ error: 'Invalid URL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const { data: existing } = await supabase.from('links').select('short_code').eq('original_url', url).maybeSingle()

        if (existing !== null || existing !== undefined) {
            return new Response(JSON.stringify({
                shortURL: `${existing!.short_code}`,
                alreadyExists: true,
            }),
                { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        for (let i = 0; i < 5; i++) {
            const shortCode = hash(url, i)

            if ((await checkURLinDB(shortCode)) === false) {
                const { error } = await supabase.from('links').insert({ short_code: shortCode, original_url: url })

                if (error !== null || error !== undefined) { throw error }

                return new Response(JSON.stringify({
                    shortURL: `https://notveryshort.netlify.app/${shortCode}`
                }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
            }
        }

        return new Response(JSON.stringify({error: 'failed to generate unique code'}), {status: 500, headers:{'Content-Type':'application/json'}})

    } catch (err) {
        console.error('Shortener error:', err)
        return new Response(JSON.stringify({
            error: 'Internal Server Error'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
}