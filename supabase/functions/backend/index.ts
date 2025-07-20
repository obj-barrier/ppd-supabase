import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";

import { OpenAI } from "jsr:@openai/openai";
import { createClient } from "jsr:@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      },
    );
    const { userId, mode } = await req.json();

    switch (mode) {
      case "thread": {
        const { data, error: dataError } = await supabase.from("user_data")
          .select(
            "data",
          ).single();
        if (dataError) {
          throw dataError;
        }

        const thread = await openai.beta.threads.create({
          messages: [{ role: "user", content: JSON.stringify(data) }],
        });

        const { error: threadError } = await supabase.from("user_data").update({
          current_thread: thread.id,
        }).eq("user_id", userId);
        if (threadError) {
          throw threadError;
        }

        return new Response(
          JSON.stringify({ thread_id: thread.id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      default: {
        return new Response('{"error": "Invalid mode"}', {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
