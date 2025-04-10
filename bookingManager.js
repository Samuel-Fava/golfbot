const Browser = require('./Browser');
const BookingBot = require('./BookingBot');
const { BookingSchedule } = require('./models/bookingSchedules');
const { CancelationMonitoring } = require('./models/cancelationMonitoring');
const { Settings, currentSettings, DateMethods } = require('./models/settings');
const moment = require('moment-timezone');

const refreshList = 300;

module.exports.create = () => new Promise(async (resolve, reject) => {
    const bots = [];
    let settings = null;
    const controller = {
        reloadSettings: async function(){
            settings = await currentSettings(true);
            bots.forEach(bot => bot.settings = settings);
        },
        deleteBot: function(botId){
            let bot = bots.find(item => item.id === botId);
            if (bot) {
                const index = bots.indexOf(bot);
                if (index >= 0) bots.splice(index,1);
                bot.destroy().then(()=>{
                    delete bot;
                });
            }
        },
    };
    await controller.reloadSettings();

    const processQuery = function(records){
        records.forEach(record => {
            if (!bots.find((item)=> item.id === record._id.toString()))
            {
                
                const bot = new BookingBot(record);
                bots.push(bot);
                bot.on('changeStatus', (newStatus, statusMessage) => {                    
                    if (bot.dataSource instanceof BookingSchedule)
                        var dataSourceQuery = BookingSchedule.findById(bot.id);
                    else 
                        var dataSourceQuery = CancelationMonitoring.findById(bot.id);
                    dataSourceQuery.then( dataSource => {
                        changeStatus(bot, newStatus, statusMessage);
                    });

                }); 
            }
        });
    };

    function changeStatus(bot, newStatus, statusMessage = "") {
        const updateStatus = (status, message = "") => {
            dataSource.status = status;
            dataSource.statusMessage = message;
            dataSource.statusTime = new Date();
            return dataSource.save();
        };

        console.log(`Bot ${bot.id} status update initiated: ${newStatus}`);

        switch (newStatus) {
            case "new":
                console.log(`Bot ${bot.id} status remains 'new'.`);
                break;
            case "captcha":
                console.log(`Bot ${bot.id} encountered CAPTCHA. Retrying after delay.`);
                setTimeout(() => {
                    bot.initialize(true); // Retry initialization after CAPTCHA
                }, settings.captchaRetryDelay || 30000); // Default delay of 30 seconds
                updateStatus("captcha", "Retrying after CAPTCHA detection.")
                    .then(() => console.log(`Bot ${bot.id} status updated to 'captcha'.`))
                    .catch(err => console.error(`Error updating bot ${bot.id} status: ${err.message}`));
                break;
            case "inprogress":
            case "initialized":
                updateStatus(newStatus === "captcha" ? "captcha" : "inprogress")
                    .then(() => console.log(`Bot ${bot.id} status updated to ${newStatus}.`))
                    .catch(err => console.error(`Error updating bot ${bot.id} status: ${err.message}`));
                break;
            case "successful":  
            case "outofdate":
            case "failed":
                updateStatus(newStatus, statusMessage)
                    .then(() => {
                        console.log(`Bot ${bot.id} status updated to ${newStatus}.`);
                        const index = bots.indexOf(bot);
                        if (index >= 0) bots.splice(index, 1);
                        console.log(`Bot ${bot.id} removed from active bots.`);
                        return bot.destroy();
                    })
                    .then(() => console.log(`Bot ${bot.id} destroyed.`))
                    .catch(err => console.error(`Error handling bot ${bot.id} lifecycle: ${err.message}`));
                break;
            default:
                console.error(`Unknown status '${newStatus}' for bot ${bot.id}.`);
        }
    }

    Browser.initialize().then(()=>{        
        const checkingBotsList = function(){
            const timeoutTask = new Date();
            timeoutTask.setMinutes( timeoutTask.getMinutes() - (settings.bookingInterval || 1) );

            const userToday = DateMethods.userToday();
            const bookingTargetDateTime = settings.bookingTargetDateTime;
            const startBeforeNow = moment(bookingTargetDateTime).add(settings.startBefore * -1, 'm' ).toDate();

            const highLimitedHour = moment(bookingTargetDateTime).add(10, 'm' ).toDate();
            
            if (startBeforeNow <= new Date() && highLimitedHour >= new Date())
            {
                BookingSchedule.find(
                    { $or : [
                        {
                            $and : [ 
                                { status: 'pending' },
                                { launchDate : userToday }
                            ]
                        },
                        {   
                            $and : [
                                { status: 'inprogress' },
                                { statusTime : timeoutTask }
                            ]
                        }
                    ] } 
                )
                .populate('account')
                .then(processQuery)
                .catch((error)=>{
                    console.error(error);
                });
            }

            const today = DateMethods.today();
            const bookingLastOpenDate = DateMethods.today();
            bookingLastOpenDate.setUTCDate(bookingLastOpenDate.getUTCDate() + settings.openTeeTimes);
            
            CancelationMonitoring.find(
                { $or : [
                    {
                        $and : [ 
                            { status: 'active' },
                            { fromDate : { $lte: bookingLastOpenDate } },
                            { toDate : { $gte: today } }
                        ]
                    },
                    {
                        $and : [ 
                            { status: 'inprogress' },
                            { statusTime : { $lt: timeoutTask } }
                        ]
                    }
                ] }
            )
            .populate('account')
            .then( records => {
                processQuery(records);
                setTimeout(checkingBotsList, refreshList);
            })
            .catch( error => {
                setTimeout(checkingBotsList, refreshList);
            });      
               
        };
        setTimeout(checkingBotsList, refreshList);

        return resolve(controller);
    }).catch((error)=>{
        // error
        return reject(error);
    });
});

/*module.exports.start = () => new Promise(async (resolve, reject) => {
    

});
*/
