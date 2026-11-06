"""Builds docs/app/suggestions.js: the library of quick suggestions Ervo picks from.

Each entry is [label, prompt, tags, group].
  label   what the chip says (short)
  prompt  what Ervo is asked when it's tapped ("" = same as the label)
  tags    when it fits, space separated, empty = any time:
            m morning (5-11), a afternoon (11-17), e evening (17-22), n night (22-5)
            wd weekday, we weekend (Fri evening counts)
            jan..dec months, win spr sum fal seasons (northern)
            city  needs the person's city ({city} is filled in)
  group   a topic, so one bar never shows two from the same group

The app shows 3 to 5, shuffled per person, refreshed every few hours.
Run:  python tools/make_suggestions.py
"""
import json, os

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "app", "suggestions.js")
S = []


def add(label, prompt="", tags="", group="misc"):
    S.append([label, prompt if prompt != label else "", tags, group])


# ---------- food near you ----------
for c in ["Tacos", "Sushi", "Pizza", "Thai food", "Ramen", "Pho", "Indian food", "BBQ", "Burgers", "Mexican food",
          "Italian food", "Chinese food", "Korean BBQ", "Mediterranean", "Greek food", "Vegan food", "Vegetarian food",
          "Breakfast tacos", "Brunch", "Bagels", "Dim sum", "Seafood", "Steakhouses", "Wings", "Fried chicken",
          "Salad places", "Poke bowls", "Ethiopian food", "Middle Eastern food", "Vietnamese food", "Japanese food",
          "Tex-Mex", "Soul food", "Cajun food", "Caribbean food", "Peruvian food", "Food trucks", "Ice cream",
          "Bakeries", "Donuts", "Coffee shops", "Boba tea", "Smoothies", "Late-night food", "Dessert spots"]:
    t = "m" if c in ("Breakfast tacos", "Brunch", "Bagels", "Donuts", "Coffee shops", "Bakeries") else "n" if c == "Late-night food" else "a e"
    if c == "Brunch":
        t = "m we"
    add(f"{c} near me", f"Find good {c.lower()} near me", t, "food-near")

# ---------- cooking ----------
BREAKFAST = ["Pancakes", "French toast", "Overnight oats", "A breakfast burrito", "Shakshuka", "A veggie omelet", "Avocado toast",
             "Chia pudding", "Banana bread", "Waffles", "Breakfast hash", "A smoothie bowl", "Egg muffins", "Granola", "Huevos rancheros"]
for d in BREAKFAST:
    add(f"How to make {d[0].lower() + d[1:]}" if d.startswith("A ") else f"How to make {d.lower()}", "", "m", "cook")
MEALS = ["Chicken fajitas", "Beef stir-fry", "Spaghetti carbonara", "Chicken curry", "Fried rice", "Tacos al pastor", "Lentil soup",
         "Chili", "Lasagna", "Salmon with veggies", "A grain bowl", "Chicken parm", "Pad thai", "Burrito bowls", "Shrimp scampi",
         "Mac and cheese", "Chicken noodle soup", "Veggie stir-fry", "Teriyaki chicken", "Black bean burgers", "Homemade pizza",
         "Beef stew", "Chicken tortilla soup", "Pesto pasta", "Stuffed peppers", "Enchiladas", "Butter chicken", "Gumbo",
         "Sheet-pan chicken", "Tofu stir-fry", "Ramen at home", "Fish tacos", "Pulled pork", "Chicken Caesar wraps",
         "Minestrone", "Quesadillas", "Bibimbap", "Jambalaya", "Falafel", "Pot roast", "Baked ziti", "Chicken shawarma",
         "Mushroom risotto", "Korean beef bowls", "Greek salad", "Turkey meatballs", "Coconut curry", "Cauliflower tacos",
         "Lemon garlic chicken", "One-pot pasta", "Chickpea curry", "Poke at home", "Carne asada", "Chicken fried rice"]
for d in MEALS:
    add(f"Recipe: {d[0].lower() + d[1:] if d.startswith('A ') else d.lower()}", f"Give me an easy recipe for {d.lower()}", "a e", "cook")
for q in ["Dinner with what I have", "Quick 15-minute dinner", "Cheap meals for the week", "Meal prep for the week",
          "High-protein snacks", "Healthy lunch ideas", "Easy dessert to bake", "What to cook tonight?", "Use up my leftovers",
          "Slow cooker ideas", "Air fryer ideas", "No-cook lunch ideas", "Make a grocery list", "Plan meals for the week"]:
    tags = "e" if "dinner" in q.lower() or "tonight" in q.lower() else "we" if "week" in q.lower() else ""
    add(q, "", tags, "cook-plan")

# ---------- things to do near you ----------
for a in ["Hiking trails", "Parks", "Bike trails", "Swimming spots", "Farmers markets", "Live music", "Comedy shows",
          "Museums", "Art galleries", "Bowling", "Mini golf", "Escape rooms", "Arcades", "Rock climbing gyms", "Yoga classes",
          "Dog parks", "Botanical gardens", "Zoos and aquariums", "Movie theaters", "Trivia nights", "Karaoke", "Board game cafes",
          "Thrift stores", "Bookstores", "Libraries", "Pickleball courts", "Basketball courts", "Soccer fields", "Tennis courts",
          "Running clubs", "Volunteer spots", "Free events", "Festivals", "Pottery classes", "Cooking classes", "Dance classes",
          "Kayaking", "Lakes", "Scenic drives", "Sunset spots", "Picnic spots", "Skate parks", "Golf courses", "Ice skating",
          "Trampoline parks", "Go-karts", "Antique shops", "Flea markets", "Night markets", "Car shows", "Sports games",
          "Concerts this week", "Open mic nights", "Study spots", "Quiet cafes", "Coworking spaces", "Gyms", "Spas",
          "Barbers and salons", "Car washes"]:
    t = "we" if a in ("Farmers markets", "Festivals", "Flea markets", "Car shows", "Kayaking", "Lakes", "Picnic spots", "Zoos and aquariums", "Scenic drives") else \
        "e" if a in ("Live music", "Comedy shows", "Trivia nights", "Karaoke", "Open mic nights", "Night markets", "Concerts this week", "Sunset spots") else \
        "wd" if a in ("Study spots", "Coworking spaces", "Quiet cafes") else ""
    add(f"{a} near me", f"Find {a.lower()} near me", t, "do-near")
for q in [("What's on this weekend?", "What's happening near me this weekend?", "we"),
          ("Fun things to do tonight", "What are fun things to do near me tonight?", "e"),
          ("Free things to do near me", "", ""), ("Rainy day ideas", "What can I do on a rainy day near me?", ""),
          ("Date night ideas", "Give me date night ideas near me", "e"), ("Something new to try", "Suggest something new to try near me this week", ""),
          ("Day trip ideas", "Give me day trip ideas within two hours of me", "we"), ("Plan a fun Saturday", "Plan a fun Saturday for me", "we"),
          ("Plan a chill Sunday", "Plan a relaxing Sunday for me", "we"), ("Group activity ideas", "Ideas for a group of friends near me", "we")]:
    add(q[0], q[1], q[2], "plan-fun")

# ---------- your city ----------
for l, p in [("Things to do in {city}", "What are the best things to do in {city}?"), ("Best coffee in {city}", "Where's the best coffee in {city}?"),
             ("Hidden gems in {city}", "What are some hidden gems in {city}?"), ("Free events in {city}", "What free events are in {city} this week?"),
             ("Best tacos in {city}", "Where are the best tacos in {city}?"), ("{city} this weekend", "What's happening in {city} this weekend?"),
             ("Fun facts about {city}", "Tell me fun facts about {city}"), ("Best parks in {city}", "What are the best parks in {city}?"),
             ("Brunch in {city}", "Where's good brunch in {city}?"), ("Live music in {city}", "Where's live music in {city} this week?"),
             ("{city} history", "Give me a short history of {city}"), ("Day trips from {city}", "What are good day trips from {city}?"),
             ("Date spots in {city}", "What are good date spots in {city}?"), ("Food festivals in {city}", "Are there food festivals in {city} soon?"),
             ("Best views in {city}", "Where are the best views in {city}?"), ("Local news in {city}", "What's the latest news in {city}?"),
             ("Farmers market in {city}", "When is the farmers market in {city}?"), ("Sports in {city}", "What sports games are in {city} soon?"),
             ("Art in {city}", "What art shows or museums are worth seeing in {city}?"), ("Weekend in {city}", "Plan a weekend in {city} for me")]:
    add(l, p, "city", "city")

# ---------- day and planning ----------
for l, p, t in [("Plan my day", "Help me plan my day", "m"), ("What's on today?", "What's coming up today?", "m"),
                ("Plan tomorrow", "Help me plan tomorrow", "e"), ("Plan my week", "Help me plan my week", "we"),
                ("Morning routine ideas", "Help me build a good morning routine", "m"), ("Wind-down routine", "Help me build a relaxing night routine", "n"),
                ("Set a focus timer", "Set a 25 minute focus timer", "a wd"), ("Remind me to drink water", "Remind me to drink water every 2 hours today", "m"),
                ("Help me prioritize", "Help me prioritize my to-do list", "wd"), ("Make a to-do list", "Help me make a to-do list for today", "m"),
                ("Plan a productive day", "Plan a productive day for me", "m wd"), ("Set an alarm for 7", "Set an alarm for 7am", "n"),
                ("Break a task into steps", "Help me break a big task into small steps", ""), ("Weekly reset checklist", "Give me a Sunday reset checklist", "we"),
                ("Study plan", "Help me make a study plan", "wd"), ("Pomodoro session", "Explain the Pomodoro method and set a timer", "wd"),
                ("Packing list for a trip", "Make me a packing list for a weekend trip", ""), ("Errand route", "Help me plan my errands in a smart order", "we"),
                ("Habit tracker ideas", "Help me start a simple habit", ""), ("Plan a birthday", "Help me plan a birthday celebration", "")]:
    add(l, p, t, "plan")

# ---------- weather and now ----------
for l, p, t in [("Weather today", "What's the weather today?", "m"), ("Weather tomorrow", "What's the weather tomorrow?", "e"),
                ("Do I need a jacket?", "Do I need a jacket today?", "m"), ("Will it rain?", "Will it rain today?", ""),
                ("Weekend forecast", "What's the weather this weekend?", "we"), ("Today's news", "What's in the news today?", "m"),
                ("Sunset time today", "What time is sunset today?", "a"), ("Good day for a walk?", "Is it a good day for a walk outside?", "a"),
                ("Air quality today", "What's the air quality near me today?", ""), ("Pollen today", "How's the pollen near me today?", "spr")]:
    add(l, p, t, "now")

# ---------- fitness ----------
for n in (10, 15, 20, 30):
    for w in ["core", "full-body", "leg", "arm", "stretching", "yoga", "HIIT", "cardio", "mobility", "back"]:
        add(f"{n}-minute {w} workout", f"Give me a {n}-minute {w} workout I can do now", "m a" if n >= 20 else "", "fit")
for l in ["Start running from zero", "Couch to 5K plan", "Workout with no equipment", "Stretch for desk workers", "Build a gym routine",
          "Walking plan for the week", "Beginner pull-up plan", "Improve my posture", "Warm-up before a run", "Cool-down stretches"]:
    add(l, f"Help me: {l.lower()}", "", "fit-plan")

# ---------- health and wellbeing ----------
for l, t in [("Tips to sleep better", "n"), ("Breathing exercise", ""), ("Quick stress relief", ""), ("Ways to drink more water", "m"),
             ("Screen-time break ideas", "a"), ("Healthy snack ideas", "a"), ("A 5-minute meditation", ""), ("How to wake up easier", "n"),
             ("Ease a headache naturally", ""), ("Journaling prompts", "e"), ("Gratitude prompt", "e"), ("Boost my energy", "a"),
             ("Calm down before bed", "n"), ("Eat more vegetables", ""), ("Cut back on sugar", ""), ("Take a mindful walk", "a"),
             ("Feel less overwhelmed", ""), ("Make time to rest", "we"), ("Reach out to a friend", "e"), ("Get more sunlight", "m")]:
    add(l, "", t, "well")
for l in ["Book a dentist checkup", "Find a doctor near me", "Remind me to take vitamins", "Schedule an eye exam", "Find urgent care near me"]:
    add(l, "", "wd", "health")

# ---------- home and errands ----------
for l, t in [("Cleaning checklist", "we"), ("Laundry tips", ""), ("Declutter one room", "we"), ("Remove a tough stain", ""),
             ("Fridge clean-out", "we"), ("Organize my closet", "we"), ("Kill fruit flies", ""), ("Unclog a drain", ""),
             ("Houseplant care tips", ""), ("Lower my energy bill", ""), ("Start a small garden", "spr"), ("Fix a squeaky door", ""),
             ("Deep clean the kitchen", "we"), ("Wash a weighted blanket", ""), ("Clean my car", "we"), ("Car maintenance checklist", ""),
             ("When to change my oil", ""), ("Check my tire pressure", ""), ("Hang a picture straight", ""), ("Make my space cozy", "fal win"),
             ("Moving checklist", ""), ("Spring cleaning list", "spr"), ("Winterize my home", "fal"), ("Keep my home cool", "sum"),
             ("Pet care reminders", ""), ("Recycling rules near me", ""), ("Donate stuff near me", "we"), ("Post office near me", "wd"),
             ("Pharmacy near me", ""), ("Gas prices near me", "")]:
    add(l, "", t, "home")

# ---------- money ----------
for l in ["Make a simple budget", "Save $500 this month", "Cut my grocery bill", "Cheap date ideas", "Find free things to do",
          "Cancel unused subscriptions", "Build an emergency fund", "Understand my credit score", "Split a bill with friends",
          "Tip calculator", "Pay off debt faster", "Compare phone plans", "Save on car insurance", "Money-saving challenges",
          "Plan a gift budget", "Meal prep to save money", "Explain a Roth IRA", "Explain compound interest", "Track my spending",
          "Side hustle ideas", "Ask for a raise", "Negotiate a bill", "Save for a trip", "Cheap weekend ideas", "Explain taxes simply"]:
    add(l, "", "", "money")

# ---------- shopping research ----------
for item, price in [("headphones", 100), ("running shoes", 120), ("a backpack", 60), ("a desk chair", 200), ("a phone case", 25),
                    ("a water bottle", 30), ("a coffee maker", 80), ("an air fryer", 100), ("a blender", 80), ("a laptop", 700),
                    ("a monitor", 200), ("a keyboard", 80), ("a mouse", 40), ("earbuds", 80), ("a smartwatch", 250), ("a rain jacket", 100),
                    ("a winter coat", 150), ("sunglasses", 60), ("a yoga mat", 40), ("dumbbells", 80), ("a power bank", 40),
                    ("a desk lamp", 40), ("bedsheets", 60), ("a pillow", 50), ("a mattress topper", 120), ("a vacuum", 200),
                    ("a robot vacuum", 300), ("a skillet", 50), ("knives", 80), ("a suitcase", 150), ("a speaker", 100),
                    ("a webcam", 70), ("a gaming headset", 80), ("a tablet", 350), ("an e-reader", 150), ("a camera", 500),
                    ("a bike", 400), ("a bike helmet", 60), ("hiking boots", 150), ("a tent", 150), ("a sleeping bag", 80),
                    ("a cooler", 80), ("a car phone mount", 25), ("a dash cam", 80), ("an electric toothbrush", 60),
                    ("a hair dryer", 60), ("a standing desk", 300), ("a humidifier", 50), ("an air purifier", 150), ("a fan", 50)]:
    add(f"Best {item.replace('a ', '', 1).replace('an ', '', 1)} under ${price}", f"What's the best {item.replace('a ', '', 1).replace('an ', '', 1)} under ${price}?", "", "shop")
for who in ["a friend", "a coworker", "a host", "a teacher", "a sibling", "a parent", "a grandparent", "a neighbor", "a new baby",
            "a book lover", "a coffee lover", "a gamer", "a reader", "a runner", "a cook", "a music lover",
            "a plant lover", "a pet owner", "a traveler", "a student"]:
    add(f"Gift ideas for {who}", "", "", "gift")

# ---------- learn something ----------
for t in ["how the stock market works", "black holes", "how vaccines work", "how AI works", "the water cycle", "inflation",
          "how airplanes fly", "photosynthesis", "how the internet works", "climate change", "the Roman Empire", "the moon landing",
          "how credit cards work", "how batteries work", "DNA", "how GPS works", "the human brain", "volcanoes", "earthquakes",
          "the solar system", "how elections work", "how bread rises", "why the sky is blue", "how Wi-Fi works", "the pyramids",
          "the Renaissance", "electric cars", "how coffee is made", "the Olympics", "sleep cycles", "the immune system",
          "how music is recorded", "how chess openings work", "quantum computing", "the ocean's deepest point", "how bees make honey",
          "how hurricanes form", "the history of pizza", "how phones work", "how a car engine works"]:
    add(f"Explain {t}"[:40], f"Explain {t} simply", "", "learn")
for l in ["Learn 5 Spanish phrases", "Learn 5 French phrases", "Learn 5 Japanese phrases", "Learn 5 Portuguese phrases",
          "Learn 5 Korean phrases", "Learn 5 sign language signs", "Learn a card trick", "Learn to juggle", "Learn chess basics",
          "Learn to cook rice right", "Learn to tie a tie", "Learn to change a tire", "Learn basic first aid", "Learn to budget",
          "Learn to meditate", "Learn a new word", "Learn guitar chords", "Learn to draw a cat", "Learn to code basics", "Learn to type faster"]:
    add(l, "", "", "learn-do")

# ---------- fun and curiosity ----------
for t in ["space", "octopuses", "the ocean", "dogs", "cats", "coffee", "chocolate", "dinosaurs", "the human body", "music",
          "soccer", "basketball", "Texas", "Japan", "Mexico", "Italy", "the Moon", "sharks", "owls", "bees", "volcanoes",
          "the brain", "money", "languages", "video games", "movies", "pizza", "tacos", "trees", "weather"]:
    add(f"Fun fact about {t}", f"Tell me a fun fact about {t}", "", "fun")
for l in ["Tell me a riddle", "Tell me a joke", "Would you rather?", "Quiz me on geography", "Quiz me on history", "Quiz me on science",
          "Trivia question", "Word of the day", "This day in history", "A brain teaser", "Two truths and a lie", "A tongue twister",
          "Random act of kindness idea", "Something to smile about", "A short story", "Pick a movie for me", "Pick a show for me",
          "Pick a book for me", "Pick a game for me", "Quote for today"]:
    add(l, "", "e" if l.startswith("Pick a") else "", "fun-play")

# ---------- watch, read, listen, play ----------
for g in ["comedy", "thriller", "sci-fi", "horror", "romance", "action", "animated", "documentary", "mystery", "feel-good"]:
    add(f"{g.capitalize()} movie picks", f"Recommend a great {g} movie", "e", "watch")
for g in ["fantasy", "mystery", "self-help", "sci-fi", "history", "biography", "thriller", "romance", "short", "classic"]:
    add(f"{g.capitalize()} book picks", f"Recommend a good {g} book", "", "read")
for a in ["the gym", "studying", "a road trip", "cooking", "cleaning", "focus", "a rainy day", "running", "a party", "falling asleep",
          "the morning", "a chill night", "the beach", "working", "a workout"]:
    add(f"Playlist for {a}", f"Suggest songs for a playlist for {a}", "n" if a == "falling asleep" else "m" if a == "the morning" else "", "listen")
for t in ["true crime", "comedy", "history", "science", "business", "sports", "health", "tech", "news", "storytelling"]:
    add(f"{t.capitalize()} podcasts", f"Recommend a good {t} podcast", "", "listen-pod")
for l in ["New music like what's trending", "Concerts near me", "Albums out this week", "Learn about a music genre", "Song of the day"]:
    add(l, "", "", "listen")
for l in ["Co-op games to play with friends", "Phone games worth playing", "Board games for a group", "Card games for two", "Party game ideas"]:
    add(l, "", "e", "play")

# ---------- people ----------
for l in ["Text to check on a friend", "Plan a game night", "Plan a potluck", "Ideas for hanging out", "Write a thank-you note",
          "Write a birthday message", "Make new friends nearby", "Plan a family video call", "Host a movie night", "Plan a dinner party",
          "Apologize the right way", "Say no politely", "Start a conversation", "Remember a birthday", "Plan a surprise"]:
    add(l, "", "", "people")

# ---------- work and school ----------
for l in ["Polish my resume", "Practice for an interview", "Write a professional email", "Ask for a day off", "Prep for a meeting",
          "Summarize an article", "Help me write an essay", "Study tips for a test", "Make flashcards", "Explain my homework",
          "Write a cover letter", "Find jobs near me", "LinkedIn profile tips", "Public speaking tips", "Beat procrastination"]:
    add(l, "", "wd", "work")

# ---------- travel ----------
for c in ["Paris", "Tokyo", "New York", "Mexico City", "London", "Rome", "Barcelona", "Seoul", "Cancun", "Chicago", "New Orleans",
          "Denver", "Nashville", "San Diego", "Las Vegas", "Miami", "Seattle", "Austin", "Banff", "Lisbon", "Amsterdam", "Iceland",
          "Hawaii", "Costa Rica", "Puerto Rico", "Yellowstone", "the Grand Canyon", "Orlando", "Toronto", "Vancouver"]:
    add(f"Plan a trip to {c}", f"Help me plan a trip to {c}", "", "travel")
for l in ["Cheap flights this month", "Weekend getaway ideas", "Road trip ideas near me", "Travel packing tips", "Beat jet lag",
          "Camping spots near me", "Beach trips near me", "Mountain trips near me", "Passport renewal steps", "Travel on a budget"]:
    add(l, "", "", "travel-plan")

# ---------- seasons and holidays ----------
for l, t in [("New Year's goals", "dec jan"), ("Valentine's Day ideas", "feb"), ("Super Bowl snacks", "jan feb"),
             ("St. Patrick's Day ideas", "mar"), ("Spring break ideas", "mar"), ("Easter brunch ideas", "mar apr"),
             ("Earth Day ideas", "apr"), ("Mother's Day ideas", "may"), ("Memorial Day plans", "may"), ("Graduation gift ideas", "may jun"),
             ("Father's Day ideas", "jun"), ("Summer bucket list", "may jun"), ("Fourth of July plans", "jun jul"),
             ("Beat the heat ideas", "jun jul aug"), ("Pool days near me", "jun jul aug"), ("Back-to-school list", "jul aug"),
             ("Labor Day plans", "aug sep"), ("Fall bucket list", "sep oct"), ("Pumpkin patches near me", "sep oct"),
             ("Halloween costume ideas", "oct"), ("Haunted houses near me", "oct"), ("Day of the Dead history", "oct nov"),
             ("Thanksgiving menu ideas", "nov"), ("Friendsgiving plan", "nov"), ("Black Friday deals to watch", "nov"),
             ("Holiday gift list", "nov dec"), ("Holiday lights near me", "dec"), ("Holiday cookie recipes", "dec"),
             ("Ugly sweater party ideas", "dec"), ("Winter skin care tips", "win"), ("Cozy soup recipes", "win fal"),
             ("Snow day ideas", "win"), ("Spring hikes near me", "spr"), ("Allergy season tips", "spr"), ("Summer road trip", "sum"),
             ("Sunscreen tips", "sum"), ("Fall recipes", "fal"), ("Leaf peeping near me", "fal"), ("Lunar New Year food", "jan feb"),
             ("Ramadan recipes", "feb mar"), ("Diwali sweets to try", "oct nov"), ("Hanukkah recipes", "dec")]:
    add(l, "", t, "season")

# ---------- hobbies ----------
for h in ["painting", "drawing", "photography", "knitting", "crochet", "gardening", "baking bread", "journaling", "birdwatching",
          "chess", "guitar", "piano", "singing", "skateboarding", "surfing", "rock climbing", "fishing", "camping", "woodworking",
          "pottery", "calligraphy", "origami", "podcasting", "video editing", "3D printing", "coding", "running", "cycling",
          "swimming", "dancing", "yoga", "martial arts", "astronomy", "a book club", "cooking new cuisines", "thrifting",
          "film photography", "candle making", "embroidery", "sewing"]:
    add(f"Get into {h}", f"How do I get started with {h}?", "we" if h in ("camping", "fishing", "surfing") else "", "hobby")

# ---------- sports ----------
for sp in ["soccer", "basketball", "tennis", "pickleball", "golf", "volleyball", "baseball", "football", "running", "swimming",
           "boxing", "climbing", "cycling", "skiing", "snowboarding", "hiking", "disc golf", "badminton", "table tennis", "bowling"]:
    add(f"{sp.capitalize()} tips for beginners", f"Give me {sp} tips for a beginner", "", "sport")
for l in ["Games on TV tonight", "Scores from today", "Sports news today", "Pickup games near me", "Join a rec league"]:
    add(l, "", "e" if "tonight" in l else "", "sport-now")

# ---------- what to make with ----------
for ing in ["chicken", "ground beef", "eggs", "rice", "pasta", "potatoes", "tofu", "chickpeas", "black beans", "lentils",
            "spinach", "zucchini", "broccoli", "sweet potatoes", "mushrooms", "avocados", "bananas", "apples", "canned tuna",
            "salmon", "shrimp", "tortillas", "bread", "cheese", "yogurt", "oats", "peanut butter", "frozen veggies", "leftover rice",
            "cauliflower", "cabbage", "carrots", "bell peppers", "tomatoes", "corn", "quinoa", "coconut milk", "ramen noodles",
            "berries", "lemons"]:
    add(f"What to make with {ing}", f"What can I make with {ing}?", "a e", "cook-with")

# ---------- kitchen skills ----------
for k in ["cook perfect rice", "boil an egg", "sear a steak", "chop an onion", "make a vinaigrette", "season cast iron",
          "make cold brew", "make pour-over coffee", "store herbs", "ripen avocados fast", "cook dried beans", "make a pan sauce",
          "bake chicken breast", "roast vegetables", "make guacamole", "make salsa", "make pizza dough", "sharpen a knife",
          "poach an egg", "make iced tea"]:
    add(f"How to {k}", "", "", "kitchen")

# ---------- phone and tech help ----------
for l in ["Speed up my phone", "Free up phone storage", "Make my battery last", "Back up my photos", "Make a strong password",
          "Spot a scam text", "Set up two-factor login", "Fix slow Wi-Fi", "Clean my laptop", "Block spam calls", "Share my location safely",
          "Turn on dark mode", "Set up screen time", "Print from my phone", "Scan a document", "Transfer photos to a computer",
          "Pick a new phone", "Pick a laptop", "Learn keyboard shortcuts", "Organize my email", "Unsubscribe from emails",
          "Make a spreadsheet", "Edit a photo", "Make a slideshow", "Use voice typing", "Set up a smart speaker", "Pick a streaming service",
          "Cancel a streaming plan", "Protect my privacy online", "Update my apps"]:
    add(l, "", "", "tech")

# ---------- pets ----------
for l in ["Dog training tips", "Cat care tips", "Vets near me", "Pet-friendly places near me", "Dog-friendly patios near me",
          "Best food for a puppy", "Keep my pet cool", "Pet sitter checklist", "Adopt a pet near me", "Fun toys for cats",
          "Walk my dog more", "Pet first aid basics", "Travel with a pet", "Fish tank basics", "Hamster care tips"]:
    add(l, "", "", "pets")

# ---------- self-care ----------
for l in ["Simple skincare routine", "Haircut ideas", "Barbers near me", "Nail salons near me", "Massage near me",
          "Take a better nap", "At-home spa night", "Fix dry hands", "Pick a new scent", "Style an outfit",
          "Build a capsule wardrobe", "Fold clothes neatly", "Iron a shirt", "Shoe care tips", "Pack a gym bag"]:
    add(l, "", "e" if "spa" in l or "nap" in l else "", "care")

# ---------- languages ----------
for lang in ["German", "Italian", "Mandarin", "Arabic", "Hindi", "Vietnamese", "Tagalog", "Russian", "Greek", "Swahili"]:
    add(f"Learn 5 {lang} phrases", "", "", "learn-do")

# ---------- more curiosity ----------
for t in ["the Sun", "honey", "penguins", "elephants", "the Amazon", "Antarctica", "ancient Egypt", "the Vikings", "Mars",
          "rainbows", "lightning", "the Internet", "chess", "the Eiffel Tower", "Mount Everest", "crows", "frogs", "mushrooms",
          "the deep sea", "glaciers"]:
    add(f"Fun fact about {t}", f"Tell me a fun fact about {t}", "", "fun")

# ---------- drinks ----------
for l in ["Mocktail ideas", "Homemade lemonade", "Iced coffee at home", "Hot chocolate recipe", "Smoothie ideas", "Tea for better sleep",
          "Agua fresca recipe", "Protein shake ideas", "Matcha latte at home", "Chai at home"]:
    add(l, "", "n" if "sleep" in l else "", "drink")

for t in ["how tides work", "how solar panels work", "how a 401(k) works", "how interest rates work", "how recycling works",
          "how 3D printers work", "how cameras work", "how noise-canceling works", "how microwaves work", "how fridges work",
          "how planes stay up", "how rainbows form", "how snow forms", "how muscles grow", "how caffeine works", "how sleep works",
          "how memory works", "how habits form", "how languages change", "how maps are made", "how money is printed",
          "how chocolate is made", "how cheese is made", "how a bill becomes law", "how the Supreme Court works", "how the Moon affects us",
          "how stars are born", "how the Northern Lights work", "how earthquakes are measured", "how lightning works",
          "how a vaccine is tested", "how dogs see color", "how cats purr", "how birds migrate", "how coral reefs grow",
          "how fireworks work", "how elevators work", "how bridges stay up", "how submarines dive", "how rockets launch",
          "how streaming works", "how passwords get hacked", "how blockchain works", "how a credit score works", "how insurance works"]:
    add(f"Explain {t}"[:40], f"Explain {t} simply", "", "learn")

# ---------- Ervo itself (so new people find what it can do) ----------
for l, p in [("What can you do?", ""), ("Set a timer for 10 min", "Set a timer for 10 minutes"), ("Add to my calendar", "Help me add something to my calendar"),
             ("Count calories in a photo", "How do I send you a meal photo to count calories?"), ("Show my Ervo Stats", ""),
             ("What do you know about me?", "What do you know about me so far?"), ("Talk to me more casually", ""), ("Keep answers short", ""),
             ("Use emojis with me", ""), ("Get to know me", "Ask me a few questions to get to know me")]:
    add(l, p, "", "ervo")

# de-dup labels, keep the first
seen, out = set(), []
for e in S:
    k = e[0].lower()
    if k in seen:
        continue
    seen.add(k)
    out.append(e)

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("// Quick suggestions Ervo picks from: [label, prompt (\"\" = label), tags, group].\n")
    f.write("// Made by tools/make_suggestions.py; edit that file, then run it.\n")
    f.write(f"// {len(out)} suggestions.\n")
    f.write("window.ERVO_SUGGESTIONS = ")
    f.write(json.dumps(out, ensure_ascii=False, separators=(",", ":")).replace("],[", "],\n["))
    f.write(";\n")
print(len(out), "suggestions,", len({e[3] for e in out}), "groups")
