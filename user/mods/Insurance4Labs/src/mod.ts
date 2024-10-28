import { DependencyContainer } from "tsyringe";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { Insurance } from "@spt/models/eft/profile/ISptProfile";
import { DatabaseService } from "@spt/services/DatabaseService";
import { MailSendService } from "@spt/services/MailSendService";
import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { InsuranceController } from "@spt/controllers/InsuranceController";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import * as fs from "node:fs";
import * as path from "node:path";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";

class Mod implements IPreSptLoadMod {

    // DO NOT leave static references to ANY resolved dependency.
    // ALWAYS use the container to resolve dependencies
    // ****** ALWAYS *******
    public static container: DependencyContainer;

    private static configPath = path.resolve(__dirname, "../config/config.json");
    private static config: Config;
    private logger: ILogger;
    // Perform these actions before server fully loads
    public preSptLoad(container: DependencyContainer): void {

        // We will save a reference to the dependency container to resolve dependencies
        // that we may need down the line
        Mod.container = container;
        Mod.config = JSON.parse(fs.readFileSync(Mod.configPath, "utf-8"));
        this.logger = Mod.container.resolve<ILogger>("WinstonLogger");
        this.logger.info("Insurance4Labs patching sendMail function of InsuranceController...")

        // Wait until InsuranceController gets resolved by the server and run code afterwards to replace
        // the login() function with the one below called 'replacementFunction()
        container.afterResolution("InsuranceController", (_t, result: InsuranceController) => {
            // We want to replace the original method logic with something different
            result.sendMail = (sessionID: string, insurance: Insurance) => {
                return this.replacementSendMail(sessionID, insurance);
            }
            // The modifier Always makes sure this replacement method is ALWAYS replaced
        }, { frequency: "Always" });

        this.logger.log("Insurance4Labs patch successful!", LogTextColor.GREEN);
    }

    public postDBLoad(container: DependencyContainer): void {
        this.logger.info("Insurance4Labs setting up Fence insurance...");

        //fence's trader ID(loaded as a const that way in the future if it changes the mod is easier to update)
        const fenceTraderId = "579dc571d53a0658a154fbec";
        const praporTraderId = "54cb50c76803fa8b248b4571";

        //all this is to get the fence json file so we can make insurance available
        const dbService = Mod.container.resolve<DatabaseService>("DatabaseService");
        const traderdb = dbService.getTables().traders;
        const fencedb = traderdb[fenceTraderId];
        const fenceBase = fencedb["base"];
        const insurancedb = fenceBase["insurance"];
        const logger = Mod.container.resolve<ILogger>("WinstonLogger");

        //make fence insurance available
        insurancedb["availability"] = true;
        insurancedb["excluded_category"] = ["62e9103049c018f425059f38"];

        //set insurance return times
        insurancedb["max_return_hour"] = Mod.config.FenceInsuranceMaxHour;
        insurancedb["min_return_hour"] = Mod.config.FenceInsuranceMinHour;
        insurancedb["max_storage_time"] = Mod.config.FenceMaxStorageTime;


        const loyaltyLeveldb = fenceBase["loyaltyLevels"];
        //iterate through every loyalty level
        for (let loyaltyLevel in loyaltyLeveldb) {
            //set loyalty price coef
            const currentLevel = loyaltyLeveldb[loyaltyLevel];
            currentLevel["insurance_price_coef"] = Mod.config.FenceInsurancePriceCoef;
        }

        //we need to grab the config server to change insurance return percentages
        const configServer = Mod.container.resolve("ConfigServer");
        const insuranceConfig = configServer.getConfig("spt-insurance");
        insuranceConfig.returnChancePercent[fenceTraderId] = Mod.config.FenceInsuranceReturnChance;

        //next let's add some dialogue to fence, by default this just gives him all the insurance dialogue that prapor has, but can be changed in the future
        this.addFenceDialogues(praporTraderId);

        this.logger.log("Fence insurance is open for business!", LogTextColor.GREEN);
    }

    public addFenceDialogues(traderIdToCopy: string): void {
        this.logger.info("insurance4Labs adding dialogue to fence for insurance messages...");

        const fenceTraderId = "579dc571d53a0658a154fbec";
        const databaseService = Mod.container.resolve<DatabaseService>("DatabaseService");
        const fenceDialogue = databaseService.getTrader(fenceTraderId).dialogue;
        const copyDialogue = databaseService.getTrader(traderIdToCopy).dialogue;

        const combinedDialogue = { ...fenceDialogue, ...copyDialogue };

        databaseService.getTrader(fenceTraderId).dialogue = combinedDialogue;
    }
    //
    //sendmail function copy from the original spt source code
    public replacementSendMail(sessionID: string, insurance: Insurance): void {
        //traderIds here so that the mod can be updated if they ever change
        const fenceTraderId = "579dc571d53a0658a154fbec";
        const praporTraderId = "54cb50c76803fa8b248b4571";

        //resolve the services for use in this function that would normally be called from the class of the function we are replacing
        const databaseService = Mod.container.resolve<DatabaseService>("DatabaseService");
        const mailSendService = Mod.container.resolve<MailSendService>("MailSendService");
        const logger = Mod.container.resolve<ILogger>("WinstonLogger");

        //hopefully this works
        const traderHelper = Mod.container.resolve<TraderHelper>("TraderHelper");

        //original code starts here
        const labsId = "laboratory";

        // After all of the item filtering that we've done, if there are no items remaining, the insurance has
        // successfully "failed" to return anything and an appropriate message should be sent to the player.
        const traderDialogMessages = databaseService.getTrader(insurance.traderId).dialogue;

        // Map is labs + insurance is disabled in base.json
        if (insurance.systemData?.location?.toLowerCase() === labsId && !databaseService.getLocation(labsId).base.Insurance) {


            // Trader has labs-specific messages
            // Wipe out returnable items
            if (traderDialogMessages.insuranceFailedLabs?.length > 0) {
                if (insurance.traderId === fenceTraderId) {
                    //run the fence insurance code
                    logger.info("Insurance4Labs found a labs insurance return that was insured by fence, intercepting");
                }
                else {
                    //run the normal insurance code
                    const insuranceFailedLabTemplates = traderDialogMessages.insuranceFailedLabs;
                    insurance.messageTemplateId = insuranceFailedLabTemplates[Math.floor(Math.random() * insuranceFailedLabTemplates.length)];
                    insurance.items = [];
                }
            }
            else {
                //very strange edge case, we have labs insurance that should have failed, but no message to attach to the failed insurance, let's try and find another dialogue message to attach
                if (traderDialogMessages.insuranceFailed?.length > 0) {
                    logger.warning("A trader was supposed to send a failed insurance message due to gear being lost on labs, but has no dialogues for labs insurance");
                    logger.info("Attempting to send a regular failed insurance message");
                    const insuranceFailedTemplates = traderDialogMessages.insuranceFailed;
                    insurance.messageTemplateId = insuranceFailedTemplates[Math.floor(Math.random() * insuranceFailedTemplates.length)];
                    insurance.items = [];
                }
                else {
                    //VERY VERY strange edge case, some trader has neither insurance failed messages or labs insurance failed messages
                    //doubt we will ever reach this code but here we are
                    logger.warning("A trader was supposed to send a failed insurance message due to gear being lost on labs, but has no dialogues for failed insurance OR for labs insurance, contact your mod author and inform them their trader is missing insurance dialogues");
                    logger.info("Sending a nice prapor message in its place");
                    const praporDialogues = databaseService.getTrader(praporTraderId).dialogue;
                    const insuranceFailedTemplates = praporDialogues.insuranceFailed;
                    insurance.messageTemplateId = insuranceFailedTemplates[Math.floor(Math.random() * insuranceFailedTemplates.length)];
                    insurance.items = [];
                }
            }
        } else if (insurance.items.length === 0) {
            // Not labs and no items to return
            const insuranceFailedTemplates = traderDialogMessages.insuranceFailed;
            insurance.messageTemplateId = insuranceFailedTemplates[Math.floor(Math.random() * insuranceFailedTemplates.length)];
        }

        // Send the insurance message
        mailSendService.sendLocalisedNpcMessageToPlayer(
            sessionID,
            traderHelper.getTraderById(insurance.traderId),
            insurance.messageType,
            insurance.messageTemplateId,
            insurance.items,
            insurance.maxStorageTime,
            insurance.systemData,
        );
    }
}

interface Config {
    FenceInsuranceMinHour: number,
    FenceInsuranceMaxHour: number,
    FenceMaxStorageTime: number,
    FenceInsurancePriceCoef: number,
    FenceInsuranceReturnChance: number,
    debug: boolean
}

export const mod = new Mod();
