const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server is starting at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error : ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secret-token", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};
const checkTweetFromFollowing = async (request, response, next) => {
  const username = request.username;
  const { tweetId } = request.params;
  const getFollowingWithTheTweet = `SELECT T1.user_id FROM
            (SELECT following_user_id AS user_id FROM follower INNER JOIN user ON 
            follower.follower_user_id = user.user_id WHERE user.username = '${username}') AS T1
            INNER JOIN 
            (SELECT user_id FROM tweet WHERE tweet_id =${tweetId}) AS T2 ON
            T1.user_id = T2.user_id;
            `;
  const following = await db.get(getFollowingWithTheTweet);
  if (following === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//Register User API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUserExistsQuery = `
    SELECT * FROM user
    WHERE username = '${username}';`;
  const dbUser = await db.get(checkUserExistsQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const hashPassword = await bcrypt.hash(password, 10);
    const addUserQuery = `
        INSERT INTO user
        (name, username, password, gender)
        VALUES
        ('${name}','${username}', '${hashPassword}', '${gender}');`;
    await db.run(addUserQuery);
    response.send("User created successfully");
  }
});

//Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserExistsQuery = `
    SELECT * FROM user
    WHERE username = '${username}';`;
  const dbUser = await db.get(checkUserExistsQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password);
    if (isPasswordCorrect === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "secret-token");
      response.send({ jwtToken });
    }
  }
});

//Get latest tweets API
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const username = request.username;
  const { offset = 0 } = request.query;
  const getTweetsQuery = `
        SELECT username, tweet, date_time AS dateTime
        FROM
        (SELECT * FROM tweet INNER JOIN user ON tweet.user_id = user.user_id) AS T1
         INNER JOIN 
        (SELECT following_user_id AS user_id FROM follower INNER JOIN user ON 
        follower.follower_user_id = user.user_id WHERE user.username = '${username}') AS T2
        ON T1.user_id = T2.user_id
        ORDER BY date_time DESC
        LIMIT 4
        OFFSET ${offset};`;

  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//Get Followings API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getFollowingsQuery = `
    SELECT name FROM 
    (SELECT following_user_id AS user_id FROM follower INNER JOIN user ON 
    follower.follower_user_id = user.user_id WHERE user.username = '${username}') AS T1
    INNER JOIN user ON T1.user_id = user.user_id;`;
  const followings = await db.all(getFollowingsQuery);
  response.send(followings);
});

//Get Followers API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getFollowersQuery = `
    SELECT name FROM 
    (SELECT follower_user_id AS user_id FROM follower INNER JOIN user ON 
    follower.following_user_id = user.user_id WHERE user.username = '${username}') AS T1
    INNER JOIN user ON T1.user_id = user.user_id;`;
  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

//Get Tweet From Tweet Id
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  checkTweetFromFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetDetailsQuery = `
        SELECT tweet, likes, replies, dateTime
        FROM
        (SELECT tweet.tweet_id , count(*) AS likes, tweet, date_time AS dateTime
        FROM tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
        GROUP BY tweet.tweet_id) AS T1
        INNER JOIN
        (SELECT tweet.tweet_id , count(*) AS replies
        FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        GROUP BY tweet.tweet_id) AS T2
        ON T1.tweet_id = T2.tweet_id
        WHERE T1.tweet_id = ${tweetId};
        `;
    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  }
);

//Get Likers of Tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  checkTweetFromFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
    SELECT username
    FROM (SELECT user_id FROM like WHERE tweet_id = ${tweetId}) AS T1
    NATURAL JOIN user;`;
    const likes = await db.all(getLikesQuery);
    response.send({ likes: likes.map((element) => element.username) });
  }
);

//Get Replies of Tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  checkTweetFromFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
    SELECT name, reply
    FROM (SELECT user_id, reply FROM reply WHERE tweet_id = ${tweetId}) AS T1
    NATURAL JOIN user;`;
    const replies = await db.all(getRepliesQuery);
    response.send({ replies });
  }
);

//Get Tweets of User
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getTweetsQuery = `
        SELECT tweet, likes, replies, dateTime
        FROM
        ((SELECT tweet.tweet_id , tweet.user_id, count(*) AS likes, tweet, date_time AS dateTime
        FROM tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
        GROUP BY tweet.tweet_id) AS T1
        INNER JOIN
        (SELECT tweet.tweet_id , count(*) AS replies
        FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        GROUP BY tweet.tweet_id) AS T2
        ON T1.tweet_id = T2.tweet_id) AS T3
        INNER JOIN user ON T3.user_id = user.user_id
        WHERE user.username = '${username}';
        `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//Create Tweet API
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT user_id as userId FROM user WHERE username = '${username}';`;
  const { userId } = await db.get(getUserIdQuery);
  const { tweet } = request.body;
  const date = new Date();

  const createTweetQuery = `
    INSERT INTO tweet
    (tweet, user_id, date_time)
    VALUES
    ('${tweet}', ${userId}, '${date}');`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//Delete Tweet API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const username = request.username;
    const findUserQuery = `SELECT * FROM tweet NATURAL JOIN user WHERE username = '${username}' AND tweet_id = ${tweetId};`;
    const user = await db.get(findUserQuery);
    if (user === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
