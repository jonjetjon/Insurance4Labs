import { DependencyContainer } from "tsyringe";


import { TraderHelper } from "@spt/helpers/TraderHelper";
import { Insurance } from "@spt/models/eft/profile/ISptProfile";
import { DatabaseService } from "@spt/services/DatabaseService";
import { MailSendService } from "@spt/services/MailSendService";

import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { InsuranceController } from "@spt/controllers/InsuranceController";
import { ILogger } from "@spt/models/spt/utils/ILogger";

class Mod implements IPreSptLoadMod
{
    // DO NOT leave static references to ANY resolved dependency.
    // ALWAYS use the container to resolve dependencies
    // ****** ALWAYS *******
    public static container: DependencyContainer;
    
    // Perform these actions before server fully loads
    public preSptLoad(container: DependencyContainer): void
    {
        // We will save a reference to the dependency container to resolve dependencies
        // that we may need down the line
        Mod.container = container;
        
        // Wait until InsuranceController gets resolved by the server and run code afterwards to replace
        // the login() function with the one below called 'replacementFunction()
        container.afterResolution("InsuranceController", (_t, result: InsuranceController) =>
        {
            // We want to replace the original method logic with something different
            result.sendMail = (sessionID: string, insurance: Insurance) =>
            {
                return this.replacementSendMail(sessionID, insurance);
            }
            // The modifier Always makes sure this replacement method is ALWAYS replaced
        }, {frequency: "Always"});
    }

    public postDBLoad(container: DependencyContainer): void {
        //all this is to get the fence json file so we can make insurance available
        const dbService = Mod.container.resolve<DatabaseService>("DatabaseService");
        const traderdb = dbService.getTables().traders;
        const fencedb = traderdb["579dc571d53a0658a154fbec"];
        const fenceBase = fencedb["base"];
        const insurancedb = fenceBase["insurance"];
        const logger = Mod.container.resolve<ILogger>("WinstonLogger");
        

        
    }


    //
    //sendmail function copy from the original spt source code
    public replacementSendMail(sessionID: string, insurance: Insurance): void {
        
        //resolve the services for use in this function that would normally be called from the class of the function we are replacing
        const databaseService = Mod.container.resolve<DatabaseService>("DatabaseService");
        const mailSendService = Mod.container.resolve<MailSendService>("MailSendService");
        const logger = Mod.container.resolve<ILogger>("WinstonLogger");

        //hopefully this works
        const traderHelper = Mod.container.resolve<TraderHelper>("TraderHelper");

        //test logger output to see if we are running the new code
        logger.info("Insurance4Labs sendMailFunction running...");
        
        
        //original code starts here
        const labsId = "laboratory";
        
        // After all of the item filtering that we've done, if there are no items remaining, the insurance has
        // successfully "failed" to return anything and an appropriate message should be sent to the player.
        const traderDialogMessages = databaseService.getTrader(insurance.traderId).dialogue;

        // Map is labs + insurance is disabled in base.json
        if (
            insurance.systemData?.location?.toLowerCase() === labsId &&
            !databaseService.getLocation(labsId).base.Insurance
        ) {
            // Trader has labs-specific messages
            // Wipe out returnable items
            if (traderDialogMessages.insuranceFailedLabs?.length > 0) {
                const insuranceFailedLabTemplates = traderDialogMessages.insuranceFailedLabs;
                insurance.messageTemplateId = insuranceFailedLabTemplates[Math.floor(Math.random() * insuranceFailedLabTemplates.length)];
                insurance.items = [];
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

export const mod = new Mod();
