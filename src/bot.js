const redis = require('redis')
const SOFA = require('sofa-js')
const uuid = require('uuid/v4')

const Bot = require('./lib/Bot')
const Fiat = require('./lib/Fiat')
const Logger = require('./lib/Logger')

// TODO: read from config file
const db = redis.createClient({
  host: 'redis',
  port: 6379,
  password: 'rlcMWNrxXgqS0xM8aWCYuE0R'
})

const DEFAULT_TIP = 1.0

let bot = new Bot()

const TOPICS = [
  {label: 'Shopping', value: 'shopping'},
  {label: 'Movies', value: 'movies'},
  {label: 'Food', value: 'food'}
]

class Question {
  constructor (text, userId, offerAmount = null) {
    this.id = uuid()
    this.text = text
    this.userId = userId
    this.offerAmount = offerAmount
  }
}

bot.hear('SOFA::Init:', (session, message) => {
  welcome(session)
})

bot.hear(/ask/i, (session, message) => {
  session.openThread('ask')
})

bot.hear(/answer/i, (session, message) => {
  session.openThread('answer')
})

bot.hear(/now/i, (session, message) => {
  // TODO: Store question in queue (related to topic)
  // TODO: Use Amazon API to fetch shopping results and IMDB for movies
})

bot.hear(/hi|hello|good day/i, (session, message) => {
  session.reply('Good day! ☀️')
})

bot.hear(/thank you/i, (session, message) => {
  session.reply('You\'re welcome ✨')
})

bot.hear(/help/i, (session, message) => {
  help(session)
})

bot.hear(/profile/i, (session, message) => {
  session.openThread('profile')
})

bot.hear(/who/i, (session, message) => {
  const topic = session.get('topic')
  if (topic) {
    session.reply(`You are a ${topic} guru!`)
  } else {
    session.reply('Tell me more about you and earn money answering questions.')
    session.openThread('profile')
  }
})

bot.hear(/.*/, (session, message) => {
  session.reply('Start by asking some questions writing "ask" or answering with "answer". Type "help" if you need more info.')
})

bot.hear('SOFA::Payment:', (session, message) => {
  if (message.fromAddress === session.config.paymentAddress) {
    // Payment from bot
    if (message.status === 'confirmed') {
      // perform special action once the payment has been confirmed
      // on the network
    } else if (message.status === 'error') {
      // oops, something went wrong with a payment we tried to send!
    }
  } else {
    // Payment to bot
    if (message.status === 'unconfirmed') {
      session.reply(`Thanks for the payment! 🙏`)
    } else if (message.status === 'confirmed') {
      // TODO: FWD payment to user that answered
    } else if (message.status === 'error') {
      session.reply(`There was an error with your payment!🚫`)
    }
  }
})

// Ask thread

bot.thread('ask').onOpen = (session) => {
  const controls = TOPICS.map(item => Object.assign({type: 'button'}, item))
  session.reply(SOFA.Message({
    body: 'What do you want to ask about?',
    controls: controls,
    showKeyboard: false
  }))
  session.setState('ask_profile')
}

bot.thread('ask').state('ask_profile').hear('SOFA::Command:', (session, message) => {
  const topic = message.content.value
  session.reply(`What would you like to know about ${topic}?`)
  session.set('ask_topic', topic)
  session.setState('ask_input')
})

bot.thread('ask').state('ask_input').hear(/.*/, (session, message) => {
  const topic = session.get('ask_topic')

  // Insert question into Q
  const question = new Question(message.content.body, session.user.token_id)

  db.lpush(topic, JSON.stringify(question), (err, data) => {
    if (err) {
      session.reply('Sorry, there was an error, please ask me again!')
      Logger.error(err)
      return
    }
    session.reply('We are working to get you answers 🏃')
  })
  session.closeThread()
})

// Answer thread

bot.thread('answer').onOpen = (session) => {
  const topic = session.get('topic')

  // Fetch Q
  db.rpoplpush(topic, topic, (err, data) => {
    if (err || !data) {
      session.reply('Sorry, I have nothing to answer right now')
      return
    }
    const question = JSON.parse(data)
    const controls = [
      {type: 'button', label: 'Answer now', value: 'answer'},
      {type: 'button', label: 'Pass', value: 'pass'},
      {type: 'button', label: 'Quit', value: 'quit'}
    ]
    session.set('currentQuestion', question)
    session.reply(SOFA.Message({
      body: 'Q: ' + question.text,
      controls: controls,
      showKeyboard: false
    }))
    session.setState('await_answer')
  })
}

bot.thread('answer').state('await_answer').hear('SOFA::Command:', (session, message) => {
  switch (message.content.value) {
    case 'answer now':
      // Wait for input
      break
    case 'pass':
      session.closeThread()
      session.openThread('answer')
      break
    case 'quit':
      session.reply('Time to relax with a coffee ☕...')
      session.closeThread()
      break
  }
})

bot.thread('answer').state('await_answer').hear(/.*/, (session, message) => {
  session.setState('have_answer')
  session.reply('Thank you for your answer')

  const question = session.get('currentQuestion')
  const controls = [
    {type: 'button', label: 'I like it', value: 'like'},
    {type: 'button', label: 'Meh', value: 'meh'}
  ]
  bot.client.send(question.userId, SOFA.Message({
    body: 'Q: ' + question.text + '\n' + 'A: ' + message.content.body,
    controls: controls
  }))
})

bot.thread('answer').state('have_answer').hear('SOFA::Command:', (session, message) => {
  switch (message.content.value) {
    case 'like':
      session.reply('Cool! let\'s give a tip for good karma ✨')
      Fiat.fetch().then((toEth) => {
        const amount = toEth.USD(DEFAULT_TIP)
        session.requestEth(amount, 'Glad I could help you')
        // TODO: Store recipient for the tip and FWD when confirmed tx
      })
      break
    case 'meh':
      session.reply('I hope you have more luck next time!')
      break
  }
  session.closeThread()
})

// Profile thread

bot.thread('profile').onOpen = (session) => {
  const controls = TOPICS.map(item => Object.assign({type: 'button'}, item))
  session.reply(SOFA.Message({
    body: `What topic do you want to answer questions about?`,
    controls: controls,
    showKeyboard: false
  }))
  session.setState('answer_profile')
}

bot.thread('profile').state('answer_profile').hear('SOFA::Command:', (session, message) => {
  switch (message.content.value) {
    case 'shopping':
      session.set('topic', 'shopping')
      session.reply('So you are a shopping guru!')
      break
    case 'movies':
      session.set('topic', 'movies')
      session.reply('So you are a movies guru!')
      break
    case 'food':
      session.set('topic', 'food')
      session.reply('So you are a foodie!')
      break
  }
  session.reply('Any time you want to change your topic write "profile" again')
  session.closeThread()
})

function welcome (session) {
  session.reply(`Hi! Welcome to Asketh, help answer questions from people and earn money. 🌈`)
  session.openThread('profile')
}

function help (session) {
  session.reply('I see that you need some help 🙂')
  session.reply('👤 Type "profile" any time you want to change the topic you want to answer questions about')
  session.reply('☝️ Type "ask" to send the community a question about a topic')
  session.reply('🙋 Type "answer" to use your knowledge and earn money!')
}
