import {
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

declare global {
  var __discord_client__: Client | undefined;
}

export let disable = process.env.DISCORD_DISABLED === "true";

export const setDisable = (value: boolean) => {
  disable = value;
};

export const getClient = () => {
  if (global.__discord_client__) {
    console.log("[Discord] Reusing cached Discord client");
    return global.__discord_client__;
  }

  console.log("[Discord] Creating new Discord client");
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once(Events.ClientReady, (readyClient: Client<true>) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  });

  if (!process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_TOKEN is not set");
  }

  client.login(process.env.DISCORD_TOKEN);
  global.__discord_client__ = client;
  return client;
};

export const postEvent = (event: string, markdown: string) => {
  if (disable) {
    return;
  }

  const threadId = process.env.DISCORD_EVENT_THREAD_ID;
  if (!threadId) {
    console.warn(`[Discord] Skipping event ${event}: no event thread configured`);
    return;
  }

  (async () => {
    try {
      const client = getClient();
      const thread = await client.channels.fetch(threadId);
      if (!thread) {
        throw new Error("Thread not found");
      }

      if (thread.isSendable()) {
        console.log(
          `Posting event ${event} to thread ${threadId}: ${markdown}`,
        );
        const container = new ContainerBuilder()
          .setAccentColor(0x1d56bf)
          .addTextDisplayComponents((textDisplay) =>
            textDisplay.setContent(markdown),
          );

        await thread.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      } else {
        throw new Error("Thread is not sendable");
      }
    } catch (error) {
      console.error(`[Discord] Failed to post event ${event}:`, error);
    }
  })();
};
