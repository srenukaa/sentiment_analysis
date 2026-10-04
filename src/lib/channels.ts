/**
 * Sentira — simulated real-time feedback channels.
 *
 * Each channel represents a different vertical where customer feedback
 * arrives in real time. These sample texts are deliberately varied —
 * mixing positive, negative, and borderline phrasing — so the live
 * pulse view produces a believable mix of sentiments.
 *
 * Used by the Pulse Stream view. The feed pulls one sample at a time
 * at a configurable interval and runs it through the HF model.
 */

export interface ChannelDef {
  id: string;
  label: string;
  blurb: string;
  samples: string[];
}

export const CHANNELS: ChannelDef[] = [
  {
    id: "ecommerce",
    label: "E-Commerce Reviews",
    blurb: "Live product reviews from a marketplace checkout flow.",
    samples: [
      "The delivery was lightning fast and the packaging felt premium, will definitely order again.",
      "Product arrived broken and customer service took three days to respond. Very disappointing.",
      "Quality is fine for the price, nothing exceptional but does the job.",
      "Absolutely love the color and the material feels great, totally worth the money.",
      "Wrong size delivered, had to return and reorder. The return process was painless though.",
      "This is hands down the best pair of headphones I have owned, the bass is incredible.",
      "Stopped working after two weeks. Tried contacting support, no response yet.",
      "Matches the description perfectly, came with a nice thank you note from the seller.",
      "The fabric started pilling after one wash, expected better at this price point.",
      "Exceeded my expectations, the build quality is solid and it looks beautiful on the shelf.",
      "Cheap plastic, feels like it will snap any moment. Returning immediately.",
      "Got this as a gift and the recipient was thrilled, would absolutely recommend.",
    ],
  },
  {
    id: "food-delivery",
    label: "Food Delivery",
    blurb: "Rider ratings and food reviews from a delivery app.",
    samples: [
      "Food arrived cold and the rider was rude. Won't be ordering from here again.",
      "Hot, fresh, and delivered ten minutes early. The biryani was absolutely delicious.",
      "Order took over an hour when the app said thirty minutes. Food was okay though.",
      "The pizza was soggy and toppings were barely there. Total waste of money.",
      "Packaging was neat and the dessert was a lovely surprise, thank you.",
      "Delivery was on time but the curry was way too salty, could not finish it.",
      "Generous portion, tasted just like home. Will order again for sure.",
      "Rider called to say he could not find the address but was very polite about it.",
      "Best burger in town, juicy and the fries were crispy to perfection.",
      "Missing one item from my order, the rest was fine but I expected better.",
    ],
  },
  {
    id: "streaming",
    label: "Streaming Feedback",
    blurb: "Live viewer comments during a sports stream.",
    samples: [
      "This commentary is brilliant, the energy is unmatched tonight.",
      "Stream keeps buffering every five minutes, ruining the whole experience.",
      "Quality of the broadcast is great, the camera angles are excellent.",
      "Why is the audio out of sync with the video, this is unwatchable.",
      "Loving the half-time analysis, really insightful stuff from the pundits.",
      "Ad breaks every two minutes, this is getting ridiculous.",
      "Picture quality dropped to 480p suddenly, please fix the servers.",
      "The pre-match show was fantastic, learned so much about both teams.",
      "Watched the whole match without a single lag, flawless stream today.",
      "Commentary team is biased towards one side, very disappointing.",
    ],
  },
  {
    id: "support",
    label: "Support Tickets",
    blurb: "Incoming customer support chat messages.",
    samples: [
      "I have been waiting for a refund for two weeks now, this is unacceptable.",
      "The agent was very patient and resolved my issue in under five minutes, thank you.",
      "I just want to know why my account was suspended without any notice.",
      "Got my issue sorted, the walkthrough was clear and easy to follow.",
      "Every time I call I am on hold for thirty minutes, what is going on.",
      "Thank you for the quick response, that solved my problem immediately.",
      "I cannot find the cancel subscription button anywhere on the dashboard.",
      "The support chat keeps disconnecting, please fix this it is frustrating.",
      "Agent was knowledgeable and friendly, five stars for the help.",
      "Why did my bill go up by twenty percent this month without any warning.",
    ],
  },
];

export const ALL_SAMPLES = CHANNELS.flatMap((c) =>
  c.samples.map((s) => ({ channel: c.id, text: s }))
);
