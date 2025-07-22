import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";

import { OpenAI } from "jsr:@openai/openai";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js";

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
    const request = await req.json();
    const userId = (await supabase.auth.getUser()).data.user!.id;

    let body;
    switch (request.func) {
      case "create-thread": {
        body = await createThread(supabase, userId);
        break;
      }
      case "send-message": {
        body = await sendMessage(supabase, userId, request.message);
        break;
      }
      case "generate-description": {
        body = await generateDescription(supabase, userId, request.productPage);
        break;
      }
      default: {
        return new Response('{"error": "Invalid mode"}', {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    return new Response(
      JSON.stringify(body),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function getThreadId(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from(
    "user_data",
  ).select("current_thread").eq("user_id", userId).single();

  return data!.current_thread;
}

async function createThread(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from(
    "user_data",
  ).select("data").eq("user_id", userId).single();

  const thread = await openai.beta.threads.create({
    messages: [{ role: "user", content: JSON.stringify(data) }],
  });

  await supabase.from("user_data").update({ current_thread: thread.id })
    .eq("user_id", userId);

  return { thread_id: thread.id };
}

async function sendMessage(
  supabase: SupabaseClient,
  userId: string,
  message: string,
) {
  const threadId = await getThreadId(supabase, userId);

  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });

  await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: Deno.env.get("CHAT_ASSIST_ID")!,
  });
  const messages = await openai.beta.threads.messages.list(threadId);

  return { message: messages.data[0].content[0] };
}

async function generateDescription(
  supabase: SupabaseClient,
  userId: string,
  productPage: string,
) {
  const chatThreadId = await getThreadId(supabase, userId);
  const messages = await openai.beta.threads.messages.list(chatThreadId);

  const descThreadId = (await openai.beta.threads.create({
    messages: [{
      role: "user",
      content: `Pre-shopping conversation with user:\n${
        JSON.stringify(messages.data)
      }\nProduct Page:\n${productPage}\n\nCreate a tailored product description for this user...`,
    }],
  })).id;

  await openai.beta.threads.runs.createAndPoll(descThreadId, {
    assistant_id: Deno.env.get("DESC_ASSIST_ID")!,
  });
  const description = await openai.beta.threads.messages.list(
    descThreadId,
  );

  return { message: description.data[0].content[0] };
}
