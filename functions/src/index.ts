// v6 of firebase-functions makes the v2 API the default export; this code
// targets the v1 API (functions.pubsub.schedule, functions.config(), etc.).
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const algoliasearch = require("algoliasearch");
const {WebClient} = require("@slack/web-api");
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

// /ALGOLIA_ID
const ALGOLIA_ID = functions.config().algolia.appid;
const ALGOLIA_ADMIN_KEY = functions.config().algolia.apikey;
const client = algoliasearch(ALGOLIA_ID, ALGOLIA_ADMIN_KEY);
const reviewIndex = client.initIndex("MSCSHUB");

// Webscraper
const axios = require("axios");
const cheerio = require("cheerio");

const nodeCrypto = require("crypto");

// --- Request authentication helpers --------------------------------------

// Constant-time comparison that tolerates differing lengths.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return nodeCrypto.timingSafeEqual(bufA, bufB);
}

// Admin HTTP endpoints require a shared secret in the `x-admin-key` header.
// Set it with: firebase functions:config:set admin.key="<secret>"
function isAuthorizedAdmin(req: any): boolean {
  const expected = (functions.config().admin || {}).key;
  if (!expected) {
    // Fail closed if no admin key is configured.
    return false;
  }
  return safeEqual(req.get("x-admin-key") || "", expected);
}

// Verify a request genuinely came from Slack using the app's signing secret.
// Set it with: firebase functions:config:set slack.signing_secret="<secret>"
function isValidSlackRequest(req: any): boolean {
  const signingSecret = (functions.config().slack || {}).signing_secret;
  if (!signingSecret) {
    return false;
  }
  const timestamp = req.get("x-slack-request-timestamp");
  const signature = req.get("x-slack-signature");
  if (!timestamp || !signature) {
    return false;
  }
  // Reject requests older than 5 minutes to prevent replay attacks.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) {
    return false;
  }
  const body = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
  const base = `v0:${timestamp}:${body}`;
  const expected = "v0=" + nodeCrypto.createHmac("sha256", signingSecret)
    .update(base).digest("hex");
  return safeEqual(signature, expected);
}

exports.slackBotScheduler = functions.pubsub.schedule("0 15 1,10,20 5,8,12 *").onRun(async (_context: any) => {
  const dateObj = new Date();
  const day = dateObj.getUTCDate();
  if (day == 1) {
    // Call the first version
    await sendMessage(1);
  } else if (day == 10) {
    // Call the second version
    await sendMessage(2);
  } else {
    // Call the third version
    await sendMessage(3);
  }
  // context.timestamp will give me a time stamp. I should be able to get the day out of this (That is all I care about)
  // We could also just get the date from the server and run off that (Probably best)
  // This should fire on the 1st, 10th and 20th of may, june (for testing), august and december)
  return null;
});


exports.SlackBotRemoveGraduates = functions.https.onRequest(async (req: any, res: any) => {
  if (!isValidSlackRequest(req)) {
    return res.status(401).send("Unauthorized");
  }
  // Respond to Slack's one-time URL verification handshake.
  if (req.body && req.body.type === "url_verification") {
    return res.status(200).send({challenge: req.body.challenge});
  }
  const user = req.body.event.user;
  const text = req.body.event.text;
  console.log(user, " said : ", text);
  return res.status(200).send({});
});

async function sendMessage(messageType: any) {
  // Token is read from Firebase runtime config, e.g.
  //   firebase functions:config:set slack.token="xoxb-..."
  const client = new WebClient(functions.config().slack.token, {
  });
  const numbersToWords = ["one", "two", "three", "four", "five... (are you insane?? Good luck!!)", "5+"];
  // Get All Channels
  const channels: any = {};
  try {
    const result = await client.conversations.list({
      exclude_archived: true,
      limit: 1000,
    });
    // Add Results to list
    result["channels"].forEach((channel: any) => {
      // Record each channel id and name
      channels[channel.name] = channel.id;
    });
  } catch (error) {
    console.error(error);
    return;
  }

  // Get all Users
  const users: any = {};
  // First we will get all users
  try {
    // Call the users.list method using the WebClient
    const result = await client.users.list();
    result.members.forEach(function(user: any) {
      // Store all user info (Adjust later)
      users[user.id] = {
        userId: user.id,
        userName: user.real_name,
        userEmail: user.profile.email,
        id: user.id,
        channels: [],
      };
    });
  } catch (error) {
    console.error(error);
    return;
  }

  // Get Class Data from Firebase
  const tokenReference = db.collection("Class");
  const classes = await tokenReference.get();
  const slackMap: any = {};
  const slackClassNameMap: any = {};
  classes.forEach((tempClass: any) => {
    const classData = tempClass.data();
    if (classData.SlackChannel != undefined) {
      // Store Data in map
      slackMap[classData.SlackChannel] = tempClass.id;
      slackClassNameMap[classData.SlackChannel] = classData.ClassName;
    }
  });

  // Now we can reduce the list of channels down to channels that are for classes.
  // Loop Through each value of slackMap and get the users.
  for (const channelName of Object.keys(slackMap)) {
    let channelId: any;
    try {
      channelId= channels[channelName];
      const channelMembers = await client.conversations.members({
        channel: channelId,
        limit: 1000,
      });
      channelMembers["members"].forEach(function(userIdToAdd: any) {
        users[userIdToAdd].channels.push(channelName);
      });
    } catch (error) {
      console.log(channelId, channelName);
    }
  }
  // I have a users object. It has all the users with the channels that
  // they subscribe to. We should be able to edit previous code.
  // User {
  //     channel: [List of channels that the user is in]
  //     userName: Name,
  //     userEmail: Email,
  // }

  // Message Number Determines what type of message it is (This will get moved to a parameter)
  // 1: The First message sent on the 1st day of the month
  // 2: Second Message sent on the 10th.
  // 3: Third message sent on the 20th.
  const messageNumber = messageType;
  await Promise.all(Object.values(users).map(async function(user: any) {
    let message = " ";
    // Get UserID from firebase
    try {
      // Set User Email:
      const userEmail = user.userEmail;
      const userIDFirebase = await admin.auth().getUserByEmail(userEmail);
      const firebaseUID = userIDFirebase.uid;
      // Add Error checking if not firebase user?

      const classesToAsk = [];
      for (const channel of user.channels) {
        // Go through and see if each user channel is a class
        if (slackMap[channel] != undefined) {
          // We have a class that we need to check if we have a review
          // We need to see if we have a review for class slackMap[channel.name] and user id userIDFirebase
          const review = await db.collection("Reviews").where("classId", "==", slackMap[channel]).where("userId", "==", firebaseUID).get();
          if (review.empty) {
            // We found a class that needs a review
            // Attempt to write
            classesToAsk.push(slackClassNameMap[channel]);
          }
        }
      }
      if (classesToAsk.length == 0) {
        // Return because there is nothing to share.
        return;
      }
      // Now we can create the string to send.
      if (messageNumber === 1) {
        message = `Hey <@${user["id"]}>! As the semester comes to a close I want to wish you good luck with finals. Would you please do me a favor and write a course review on the hub? It's a great way to give back to the community and share your thoughts on how the semester went. If you have used The Hub you know how useful it is to read about the experiences other people had. \n\n I notice that you're in ${classesToAsk.length < 5 ? numbersToWords[classesToAsk.length-1] : numbersToWords[5]} class channel${classesToAsk.length > 1 ? "s" : ""} (${classesToAsk.join(", ")}) that you haven't written a review for. Would you please take a moment to write a review for those classes? I know you're probably pretty busy studying but this really does help everyone out. Good luck with your finals and I look forward to seeing your review on <https://mscshub.com/ | MSCS Hub> soon! \n\n It's no big deal if you can't get to it now or want to wait until your final is over before writing a review. I'll follow up with you in a week with a gentle reminder once the semester is over. Your feedback is important and your classmates will appreciate it!`;
      } else if (messageNumber == 2) {
        message = `Hey <@${user["id"]}>! I just wanted to check in again on course reviews. Based on your class channels I see that you still need to write a review for the following channel${classesToAsk.length > 1 ? "s" : ""} :  ${classesToAsk.join(", ")}. I know that reviews can take time but they help the entire community. I look forward to seeing your review on <https://mscshub.com/ | MSCS Hub> soon! \n\n It's no big deal if you can't get to it now or want to wait until your final is over before writing a review. I'll follow up one more time. Your feedback is important and your classmates will appreciate it!`;
      } else {
        message = `Hey <@${user["id"]}>! Congrats on finishing the semester. I just wanted to check in one last time to see if you have written all your reviews. I look forward to seeing your review on <https://mscshub.com/ | MSCS Hub> soon!`;
      }
    } catch {
      if (user.channels.length == 0) {
        // If They aren't in a channel move on.
        return;
      }
      const classesToAsk = [];
      for (const channel of user.channels) {
        if (slackMap[channel] != undefined) {
          classesToAsk.push(slackClassNameMap[channel]);
        }
      }
      if (classesToAsk.length == 0) {
        // Return because there is nothing to send.
        return;
      }
      message = `Hey <@${user["id"]}>! As the semester comes to a close I want to wish you good luck with finals. Would you please do me a favor and sign-up for and write a course review on the hub? It's a great way to give back to the community and share your thoughts on how the semester went. If you have used The Hub you know how useful it is to read about the experiences other people had. \n\n I notice that you're in ${classesToAsk.length < 5 ? numbersToWords[classesToAsk.length-1] : numbersToWords[5]} class channel${classesToAsk.length > 1 ? "s" : ""} (${classesToAsk.join(", ")}) that you haven't written a review for. Would you please take a moment to write a review for those classes? I know you're probably pretty busy studying but this really does help everyone out. Good luck with your finals and I look forward to seeing your review on <https://mscshub.com/ | MSCS Hub> soon! \n\n It's no big deal if you can't get to it now or want to wait until your final is over before writing a review. I'll follow up with you in a week with a gentle reminder once the semester is over. Your feedback is important and your classmates will appreciate it!`;
      // message = `Hey <@${user["id"]}>, I wanted to follow up with you again. I noticed that you're in the following channel${classesToAsk.length > 1 ? "s" : ""} (${classesToAsk.join()}). Would you please take a moment tp write a review for ${classesToAsk.Length > 1 ? "those classes" : "that class"}. I know you're probably pretty busy studying but this really does help everyone out. Good luck with your finals and I look forward to seeing your review on <https://mscshub.com/ | MSCS Hub> soon!`
    }


    // Send the message to the user
    // Send Message
    try {
      // Call the chat.postMessage method using the WebClient
      await client.chat.postMessage({
        channel: user["id"],
        text: message,
        link_names: 1,
        unfurl_links: true,
      });
    } catch (error) {
      console.error(error);
    }
  }));
}

exports.ScrapeWeb = functions.https.onRequest(async (req: any, res: any) => {
  if (!isAuthorizedAdmin(req)) {
    return res.status(403).send("Forbidden");
  }
  try {
    const response = await axios.get("https://www.cs.utexas.edu/graduate-program/masters-program/online-option/courses");
    const $ = cheerio.load(response.data);
    // const stuff = $("div.entity.entity-paragraphs-item.paragraphs-item-para-columns.full-width.chalk-bg");
    const classImages = $("div.column-cell.column-image");
    // const classTitles = $("p.card-title");
    const classAdditionalInfoLink = $("a.btn-outline.burnt");
    // For each additional Link get the link and pull the page
    for (let i = 0; i < classAdditionalInfoLink.length; i++) {
      const base = "https://www.cs.utexas.edu";
      const link = $(classAdditionalInfoLink[i]).attr("href");

      // Data From Previous page
      // const courseTitle = $(classTitles[i]).text();
      const classImage = $(classImages[i]).children("a").children("img").attr("src");
      const classDetailResponse = await axios.get(base+link);
      const courseDetailsPage = cheerio.load(classDetailResponse.data);
      const courseTitleElement = courseDetailsPage("h1.white.flat-bottom", "div.hero-row.text-left");
      const courseTitle = courseTitleElement.text();
      // Get The Style
      const colorElement = courseDetailsPage("div.entity.entity-paragraphs-item.paragraphs-item-para-hero.full-width.hero-level-two");
      const colorFullStyle = colorElement.attr("style");
      const colorFullStyleList = colorFullStyle.split(" ");
      const colorIndex = colorFullStyleList.findIndex((element: any) => element.startsWith("linear-gradient("));
      const colorFinal = colorFullStyleList[colorIndex] + " " + colorFullStyleList[colorIndex+1];
      // Get Course Details
      const courseNumberElement = courseDetailsPage("h3.white", "div.content");
      const courseNumber = courseNumberElement.text().trim();
      // Now we need to look up on firebase by course name; if not there,
      // push this data. The rest can be filled out by students.
      let classFound = false;
      const classes = await db.collection("Class").get();
      classes.forEach((classSnapshot: any) => {
        const classData = classSnapshot.data();
        if (classData.ClassName === courseTitle) {
          classFound = true;
          return;
        }
      });

      if (!classFound) {
        // Add the class
        const newClassData = {
          BookUsefulnessAvg: 0,
          BookUsefulnessCount: 0,
          ClassName: courseTitle,
          CourseNumber: courseNumber,
          DifficultyAvg: 0,
          DifficultyCount: 0,
          GraphicColor: colorFinal,
          GraphicThumbnail: base + classImage,
          GraphicUrl: "url(" + base + classImage + ")",
          LectureQualityAvg: 0,
          LectureQualityCount: 0,
          PiazzaCommunityAvg: 0,
          PiazzaCommunityCount: 0,
          ProfessorQualityAvg: 0,
          ProfessorQualityCount: 0,
          RatingAvg: 0,
          RatingCount: 0,
          SlackChannel: null,
          SlackChannelLink: null,
          Teacher: null,
          Textbook: null,
          TextbookName: null,
          WorkloadAvg: 0,
          WorkLoadCount: 0,
          category: null,
          computerScience: {},
          dataScience: {},
          langauges: [],
          meta: {},
          season: {},
        };
        await db.collection("Class").add(newClassData);
      }
    }
    res.status(200).end();
  } catch (Error) {
    console.log(Error);
    res.status(500).end();
  }
  return;
});

exports.RecalcClass = functions.https.onRequest(async (req: any, res: any) => {
  if (!isAuthorizedAdmin(req)) {
    return res.status(403).send("Forbidden");
  }
  // Lets pre-get the reviews
  const docs = await db.runTransaction(() => db.collection("Reviews").get());

  const tokenReference = db.collection("Class");
  const classes = await tokenReference.get();
  // for (const tempClass of classes){
  classes.forEach((tempClass: any) => {
    const classId = tempClass.id;
    // if(classId != "n9K6hICtMfbonUzzWPcj"){
    //     return;
    // }
    const classMap: any = {
      RatingAvg: 0,
      RatingCount: 0,
      DifficultyAvg: 0,
      DifficultyCount: 0,
      WorkloadAvg: 0,
      WorkloadCount: 0,
      BookUsefulnessAvg: 0,
      BookUsefulnessCount: 0,
      LectureQualityAvg: 0,
      LectureQualityCount: 0,
      PiazzaCommunityAvg: 0,
      PiazzaCommunityCount: 0,
      ProfessorQualityAvg: 0,
      ProfessorQualityCount: 0,
    };
    // Calculate the totals
    docs.forEach((doc: any) =>{
      const tempDoc = doc.data();
      if (tempDoc.classId == classId) {
        // Copy Data:
        if (tempDoc.bookUsefulness != -1) {
          classMap["BookUsefulnessAvg"] = classMap["BookUsefulnessAvg"] + tempDoc.bookUsefulness;
          classMap["BookUsefulnessCount"]++;
        }
        if (tempDoc.difficulty != -1) {
          classMap["DifficultyAvg"] = classMap["DifficultyAvg"] + tempDoc.difficulty;
          classMap["DifficultyCount"]++;
        }
        if (tempDoc.lectureQuality != -1) {
          classMap["LectureQualityAvg"] = classMap["LectureQualityAvg"] + tempDoc.lectureQuality;
          classMap["LectureQualityCount"]++;
        }
        if (tempDoc.piazzaCommunity != -1) {
          classMap["PiazzaCommunityAvg"] = classMap["PiazzaCommunityAvg"] + tempDoc.piazzaCommunity;
          classMap["PiazzaCommunityCount"]++;
        }
        if (tempDoc.professorQuality != -1) {
          classMap["ProfessorQualityAvg"] = classMap["ProfessorQualityAvg"] + tempDoc.professorQuality;
          classMap["ProfessorQualityCount"]++;
        }
        if (tempDoc.rating != -1) {
          classMap["RatingAvg"] = classMap["RatingAvg"] + tempDoc.rating;
          classMap["RatingCount"]++;
        }
        if (tempDoc.workload != -1) {
          classMap["WorkloadAvg"] = classMap["WorkloadAvg"] + tempDoc.workload;
          classMap["WorkloadCount"]++;
        }
      }
    });
    // Now we turn the totals into average
    if (classMap["BookUsefulnessCount"] > 0) {
      classMap["BookUsefulnessAvg"] = classMap["BookUsefulnessAvg"]/classMap["BookUsefulnessCount"];
    }
    if (classMap["DifficultyCount"] > 0) {
      classMap["DifficultyAvg"] = classMap["DifficultyAvg"]/classMap["DifficultyCount"];
    }
    if (classMap["LectureQualityCount"] > 0) {
      classMap["LectureQualityAvg"] = classMap["LectureQualityAvg"]/classMap["LectureQualityCount"];
    }
    if (classMap["PiazzaCommunityAvgCount"] > 0) {
      classMap["PiazzaCommunityAvgAvg"] = classMap["PiazzaCommunityAvgAvg"]/classMap["PiazzaCommunityAvgCount"];
    }
    if (classMap["ProfessorQualityCount"] > 0) {
      classMap["ProfessorQualityAvg"] = classMap["ProfessorQualityAvg"]/classMap["ProfessorQualityCount"];
    }
    if (classMap["RatingCount"] > 0) {
      classMap["RatingAvg"] = classMap["RatingAvg"]/classMap["RatingCount"];
    }
    if (classMap["WorkloadCount"] > 0) {
      classMap["WorkloadAvg"] = classMap["WorkloadAvg"]/classMap["WorkloadCount"];
    }
    // Now to perform the update
    return db.collection("Class").doc(classId).update(classMap).then(() => {
      return res.status(200).send("Success");
    });
  });
});


// Create Inital Maps (This will removed once it works)
exports.createClassMaps = functions.https.onRequest((req: any, res: any) => {
  if (!isAuthorizedAdmin(req)) {
    return res.status(403).send("Forbidden");
  }
  const classMap = new Map();

  return db.collection("Reviews").get().then((docs: any) => {
    docs.forEach((doc: any) =>{
      const tempDoc = doc.data();
      // For each doc.
      // See if we have a map for the class already.
      if (classMap.has(tempDoc.classId) == false) {
        // Add the map
        classMap.set(tempDoc.classId, new Map());
      }
      // Create semester
      const semYear = String(tempDoc.semester).concat(" ").concat(String(tempDoc.year));
      // Now we can add the data
      if (classMap.get(tempDoc.classId).has(semYear) == false) {
        classMap.get(tempDoc.classId).set(semYear, 0);
      }
      // Now Increment
      classMap.get(tempDoc.classId).set(semYear, classMap.get(tempDoc.classId).get(semYear) + 1);
    });
    // Now to set the values
    // const _mapIter = classMap[Symbol.iterator]();
    const promises = [];
    for ( const [classId, _tempClassMap] of classMap) {
      // For Testing
      // console.log(`${classId}: ${classMap.get(classId)}`);
      console.log(classMap.get(classId));
      const mapToSend: any = {};
      classMap.get(classId).forEach((value: any, key: any) => {
        mapToSend[key] = value;
      });
      // After this we would push the data to be updated on Firebase
      const p = db.collection("Class").doc(classId).update({
        semesters: mapToSend,
      });
      promises.push(p);
    }
    return Promise.all(promises);
  }).catch((error: any) => {
    console.log("Error getting reviews");
    console.log(error);
    return;
  });
});

// Returns [New Avg, New Count]
function addToAvg(newValue: any, currentAvg: any, currentCount: any, restrictedField: any) {
  let updatedAvg = 0;
  let updatedCount = 0;
  // Make sure that the values exist
  if (currentAvg == null) {
    currentAvg = 0;
    currentCount = 0;
  }
  if (newValue >= 0) {
    if (restrictedField == true && newValue > 7) {
      updatedAvg = currentAvg;
      updatedCount = currentCount;
    } else {
      updatedAvg = currentAvg + (1/(currentCount + 1))*(newValue - currentAvg);
      updatedCount = currentCount + 1;
    }
  } else {
    updatedAvg = currentAvg;
    updatedCount = currentCount;
  }
  return [updatedAvg, updatedCount];
}

function subtractFromAvg(newValue: any, currentAvg: any, currentCount: any) {
  let updatedAvg = 0;
  let updatedCount = 0;
  if (currentCount <= 0) {
    return [0, 0];
  }
  // Make sure that the values exist
  if (currentAvg == null) {
    currentAvg = 0;
    currentCount = 0;
  }
  if (newValue >= 0) {
    if (currentCount == 1) {
      updatedAvg = 0;
      updatedCount = 0;
    } else {
      updatedAvg = (1/(currentCount - 1))*(currentAvg*currentCount-newValue);
      updatedCount = currentCount - 1;
    }
  } else {
    updatedAvg = currentAvg;
    updatedCount = currentCount;
  }
  return [updatedAvg, updatedCount];
}

exports.DeleteRating = functions.firestore.document("/Reviews/{documentId}").onDelete(async (snap: any, _context: any) =>{
  // Snapshot is data deleted
  const review = snap.data();
  // Get the Class Document
  const classSnapShot = db.collection("Class").doc(review.classId);
  try {
    await db.runTransaction(async (t: any) => {
      const snapShot = await t.get(classSnapShot);
      const classToUpdate = snapShot.data();
      if (classToUpdate == undefined) {
        throw new Error("No Doc Found");
      }
      // Update Review
      const ratingReturn = subtractFromAvg(review.rating, classToUpdate.RatingAvg, classToUpdate.RatingCount);
      // Update Difficulty
      const difficultyReturn = subtractFromAvg(
        review.difficulty, classToUpdate.DifficultyAvg, classToUpdate.DifficultyCount);
      // Update Workload
      const workloadReturn = subtractFromAvg(review.workload, classToUpdate.WorkloadAvg, classToUpdate.WorkloadCount);
      // Bookusefulness
      const bookUsefulnessReturn = subtractFromAvg(
        review.bookUsefulness, classToUpdate.BookUsefulnessAvg, classToUpdate.BookUsefulnessCount);
      // Add lectureQuality
      const lectureQualityReturn = subtractFromAvg(
        review.lectureQuality, classToUpdate.LectureQualityAvg, classToUpdate.LectureQualityCount);
      // Add piazzaCommunity
      const piazzaReturn = subtractFromAvg(
        review.piazzaCommunity, classToUpdate.PiazzaCommunityAvg, classToUpdate.PiazzaCommunityCount);
      // Add professorQuality
      const professorQualityReturn = subtractFromAvg(
        review.professorQuality, classToUpdate.ProfessorQualityAvg, classToUpdate.ProfessorQualityCount);

      const season = classToUpdate.season;
      const semesterMap = classToUpdate.semesters;
      // Create String
      const semesterYear = String(review.semester).concat(" ").concat(String(review.year));
      semesterMap[semesterYear] = semesterMap[semesterYear] - 1;
      if (semesterMap[semesterYear] <= 0) {
        let removeSemester = true;
        // We are dealing with 0 on the semester
        semesterMap[semesterYear] = 0;
        // We need to see if this map has any other years that this happens
        for (const key in semesterMap) {
          if (!Object.prototype.hasOwnProperty.call(semesterMap, key)) continue;
          const keySplit = key.split(" ");
          if (keySplit[0] == review.semester && semesterMap[key] > 0) {
            // We have found proof that we are good
            removeSemester = false;
            break;
          }
        }
        if (removeSemester == true) {
          season[review.semester.toLowerCase()] = false;
        }
        delete semesterMap[semesterYear];
      }

      // Return
      const updates = {
        RatingAvg: ratingReturn[0],
        RatingCount: ratingReturn[1],
        DifficultyAvg: difficultyReturn[0],
        DifficultyCount: difficultyReturn[1],
        WorkloadAvg: workloadReturn[0],
        WorkloadCount: workloadReturn[1],
        BookUsefulnessAvg: bookUsefulnessReturn[0],
        BookUsefulnessCount: bookUsefulnessReturn[1],
        LectureQualityAvg: lectureQualityReturn[0],
        LectureQualityCount: lectureQualityReturn[1],
        PiazzaCommunityAvg: piazzaReturn[0],
        PiazzaCommunityCount: piazzaReturn[1],
        ProfessorQualityAvg: professorQualityReturn[0],
        ProfessorQualityCount: professorQualityReturn[1],
        semesters: semesterMap,
        season: season,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };
      t.update(classSnapShot, updates);
    });
    return;
  } catch (e) {
    console.log("Transaction Failure: ", e);
    return;
  }
});


function sameDocs(before: any, after: any) {
  if (before.bookUsefulness != after.bookUsefulness) {
    return false;
  }
  if (before.difficulty != after.difficulty) {
    return false;
  }
  if (before.exams != after.exams) {
    return false;
  }
  if (before.helpfulNegative != after.helpfulNegative) {
    return false;
  }
  if (before.helpfulPositive != after.helpfulPositive) {
    return false;
  }
  if (before.homework != after.homework) {
    return false;
  }
  if (before.lectureQuality != after.lectureQuality) {
    return false;
  }
  if (before.peerReviewed != after.peerReviewed) {
    return false;
  }
  if (before.piazzaCommunity != after.piazzaCommunity) {
    return false;
  }
  if (before.professorQuality != after.professorQuality) {
    return false;
  }
  if (before.rating != after.rating) {
    return false;
  }
  if (before.semester != after.semester) {
    return false;
  }
  if (before.workload != after.workload) {
    return false;
  }
  if (before.year != after.year) {
    return false;
  }
  if (before.projects != after.projects) {
    return false;
  }
  return true;
}

exports.AdjustReview = functions.firestore.document("/Reviews/{documentId}").onUpdate(async (snap: any, _context: any) =>{
  const before = snap.before.data();
  const after = snap.after.data();
  if (sameDocs(before, after)) {
    return;
  }
  const classSnapShot = db.collection("Class").doc(before.classId);
  // Go through and check everything.
  try {
    await db.runTransaction(async (t: any) => {
      const snapShot = await t.get(classSnapShot);
      const classToUpdate = snapShot.data();
      if (classToUpdate == undefined) {
        throw new Error("No Doc Found");
      }
      let ratingReturn = [classToUpdate.RatingAvg, classToUpdate.RatingCount];
      let difficultyReturn = [classToUpdate.DifficultyAvg, classToUpdate.DifficultyAvg];
      let workloadReturn = [classToUpdate.WorkloadAvg, classToUpdate.WorkloadCount];
      let bookUsefulnessReturn = [classToUpdate.BookUsefulnessAvg, classToUpdate.BookUsefulnessCount];
      let lectureQualityReturn = [classToUpdate.LectureQualityAvg, classToUpdate.LectureQualityCount];
      let piazzaReturn = [classToUpdate.PiazzaCommunityAvg, classToUpdate.PiazzaCommunityCount];
      let professorQualityReturn = [classToUpdate.PiazzaCommunityAvg, classToUpdate.PiazzaCommunityCount];


      // Check Rating
      if (before.rating != after.rating) {
        // We need to adjust
        // Delete out old rating
        ratingReturn = subtractFromAvg(before.rating, classToUpdate.RatingAvg, classToUpdate.RatingCount);
        // Add New Rating
        ratingReturn = addToAvg(after.rating, ratingReturn[0], ratingReturn[1], true);
      }
      // Check Difficulty
      if (before.difficulty != after.difficulty) {
        difficultyReturn = subtractFromAvg(
          before.difficulty, classToUpdate.DifficultyAvg, classToUpdate.DifficultyCount);
        // Add new Rating
        difficultyReturn = addToAvg(after.difficulty, difficultyReturn[0], difficultyReturn[1], true);
      }
      // Check Workload
      if (before.workload != after.workload) {
        workloadReturn = subtractFromAvg(before.workload, classToUpdate.WorkloadAvg, classToUpdate.WorkloadCount);
        // Add new Rating
        workloadReturn = addToAvg(after.workload, workloadReturn[0], workloadReturn[1], false);
      }
      // Check BookUsefulness
      if (before.bookUsefulness != after.bookUsefulness) {
        bookUsefulnessReturn = subtractFromAvg(
          before.bookUsefulness, classToUpdate.BookUsefulnessAvg, classToUpdate.BookUsefulnessCount);
        // Add new Rating
        bookUsefulnessReturn = addToAvg(after.bookUsefulness, bookUsefulnessReturn[0], bookUsefulnessReturn[1], true);
      }
      // Check lectureQuality
      if (before.lectureQuality != after.lectureQuality) {
        lectureQualityReturn = subtractFromAvg(
          before.lectureQuality, classToUpdate.LectureQualityAvg, classToUpdate.LectureQualityCount);
        // Add new Rating
        lectureQualityReturn = addToAvg(after.lectureQuality, lectureQualityReturn[0], lectureQualityReturn[1], true);
      }
      // check PiazzaCommunity
      if (before.piazzaCommunity != after.piazzaCommunity) {
        piazzaReturn = subtractFromAvg(
          before.piazzaCommunity, classToUpdate.PiazzaCommunityAvg, classToUpdate.PiazzaCommunityCount);
        // Add new Rating
        piazzaReturn = addToAvg(after.piazzaCommunity, piazzaReturn[0], piazzaReturn[1], true);
      }
      // check ProfessorQuality
      if (before.professorQuality != after.professorQuality) {
        professorQualityReturn = subtractFromAvg(
          before.professorQuality, classToUpdate.ProfessorQualityAvg, classToUpdate.ProfessorQualityCount);
        // Add new Rating
        professorQualityReturn = addToAvg(
          after.professorQuality, professorQualityReturn[0], professorQualityReturn[1], true);
      }

      // Change Semesters
      const oldSemesterYear = String(before.semester).concat(" ".concat(String(before.year)));
      const newSemesterYear = String(after.semester).concat(" ".concat(String(after.year)));
      const classSemesterYearMap = classToUpdate.semesters;
      const classSeason = classToUpdate.season;
      // Update Map
      // Decrement old
      classSemesterYearMap[oldSemesterYear] = classSemesterYearMap[oldSemesterYear] - 1;

      // Increase new
      if (classSemesterYearMap[newSemesterYear] == undefined) {
        // We need to add the value
        classSemesterYearMap[newSemesterYear] = 0;
      }
      classSemesterYearMap[newSemesterYear] = classSemesterYearMap[newSemesterYear] + 1;

      // Now adjust Seasons
      if (classSemesterYearMap[oldSemesterYear] <= 0) {
        // We need to remove a value from JSON Object

        // We may need to remove a season
        let removeSemester = true;
        // We are dealing with 0 on the semester
        classSemesterYearMap[oldSemesterYear] = 0;
        // We need to see if this map has any other years that this happens
        for (const key in classSemesterYearMap) {
          if (!Object.prototype.hasOwnProperty.call(classSemesterYearMap, key)) {
            continue;
          }
          const keySplit = key.split(" ");
          if (keySplit[0] == before.semester && classSemesterYearMap[key] > 0) {
            // We have found proof that we are good
            removeSemester = false;
            break;
          }
        }
        if (removeSemester == true) {
          classSeason[before.semester.toLowerCase()] = false;
        }
        delete classSemesterYearMap[oldSemesterYear];
      }

      if (classSemesterYearMap[newSemesterYear] == 1) {
        // We may need to update the season for newSemesterYear
        classSeason[after.semester.toLowerCase()] = true;
      }

      // Update Score
      let negative = after.helpfulNegative;
      if (negative <= 0) {
        negative = 0;
      }
      let positive = after.helpfulPositive;
      if (positive <= 0) {
        positive = 0;
      }
      // Calculate new score
      const total = positive + negative;
      const newWilsonScore =
        ((positive + 1.9208) / total -
          1.96 * Math.sqrt((positive * negative) / total + 0.9604) / total) /
        (1 + 3.8416 / total);

      // Return
      const classUpdates = {
        RatingAvg: ratingReturn[0],
        RatingCount: ratingReturn[1],
        DifficultyAvg: difficultyReturn[0],
        DifficultyCount: difficultyReturn[1],
        WorkloadAvg: workloadReturn[0],
        WorkloadCount: workloadReturn[1],
        BookUsefulnessAvg: bookUsefulnessReturn[0],
        BookUsefulnessCount: bookUsefulnessReturn[1],
        LectureQualityAvg: lectureQualityReturn[0],
        LectureQualityCount: lectureQualityReturn[1],
        PiazzaCommunityAvg: piazzaReturn[0],
        PiazzaCommunityCount: piazzaReturn[1],
        ProfessorQualityAvg: professorQualityReturn[0],
        ProfessorQualityCount: professorQualityReturn[1],
        season: classSeason,
        semesters: classSemesterYearMap,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };
      t.update(classSnapShot, classUpdates);
      const reviewUpdates = {
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        wilsonScore: newWilsonScore,
      };
      const reviewSnapShot = db.collection("Reviews").doc(snap.after.id);
      t.update(reviewSnapShot, reviewUpdates);
    });
    return;
  } catch (e) {
    console.log("Transaction Failure: ", e);
    return;
  }
});

exports.NewRating = functions.firestore.document("/Reviews/{documentId}").onCreate(async (snap: any, _context: any) =>{
  const review = snap.data();
  // Get the class document and update
  const classSnapShot = db.collection("Class").doc(review.classId);

  try {
    await db.runTransaction(async (t: any) => {
      const snapShot = await t.get(classSnapShot);
      const classToUpdate = snapShot.data();
      if (classToUpdate == undefined) {
        throw new Error("No Doc Found");
      }
      // Update Review
      const ratingReturn = addToAvg(review.rating, classToUpdate.RatingAvg, classToUpdate.RatingCount, true);
      // Update Difficulty
      const difficultyReturn = addToAvg(
        review.difficulty, classToUpdate.DifficultyAvg, classToUpdate.DifficultyCount, true);
      // Update Workload
      const workloadReturn = addToAvg(review.workload, classToUpdate.WorkloadAvg, classToUpdate.WorkloadCount, false);
      // Bookusefulness
      const bookUsefulnessReturn = addToAvg(
        review.bookUsefulness, classToUpdate.BookUsefulnessAvg, classToUpdate.BookUsefulnessCount, true);
      // Add lectureQuality
      const lectureQualityReturn = addToAvg(
        review.lectureQuality, classToUpdate.LectureQualityAvg, classToUpdate.LectureQualityCount, true);
      // Add piazzaCommunity
      const piazzaReturn = addToAvg(
        review.piazzaCommunity, classToUpdate.PiazzaCommunityAvg, classToUpdate.PiazzaCommunityCount, true);
      // Add professorQuality
      const professorQualityReturn = addToAvg(
        review.professorQuality, classToUpdate.ProfessorQualityAvg, classToUpdate.ProfessorQualityCount, true);


      const semesterMap = classToUpdate.semesters;
      const season = classToUpdate.season;
      // Create String
      const semesterYear = String(review.semester).concat(" ".concat(String(review.year)));
      if (semesterMap[semesterYear] == undefined) {
        // We need to add the value
        semesterMap[semesterYear] = 0;
      }
      semesterMap[semesterYear] = semesterMap[semesterYear] + 1;
      // Set Season to True
      season[review.semester.toLowerCase()] = true;

      // Return
      const updates = {
        RatingAvg: ratingReturn[0],
        RatingCount: ratingReturn[1],
        DifficultyAvg: difficultyReturn[0],
        DifficultyCount: difficultyReturn[1],
        WorkloadAvg: workloadReturn[0],
        WorkloadCount: workloadReturn[1],
        BookUsefulnessAvg: bookUsefulnessReturn[0],
        BookUsefulnessCount: bookUsefulnessReturn[1],
        LectureQualityAvg: lectureQualityReturn[0],
        LectureQualityCount: lectureQualityReturn[1],
        PiazzaCommunityAvg: piazzaReturn[0],
        PiazzaCommunityCount: piazzaReturn[1],
        ProfessorQualityAvg: professorQualityReturn[0],
        ProfessorQualityCount: professorQualityReturn[1],
        semesters: semesterMap,
        season: season,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };
      t.update(classSnapShot, updates);

      const reviewUpdate = {
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };
      const docRef: any = db.collection("Reviews").doc(snap.id);
      t.update(docRef, reviewUpdate);

      // Add Record to search on Algio
      const record = {
        objectID: snap.id,
        review: review.review,
        className: review.course,
      };
      reviewIndex.saveObject(record);
    });
    return;
  } catch (e) {
    console.log("Transaction Failure: ", e);
    return;
  }
});

