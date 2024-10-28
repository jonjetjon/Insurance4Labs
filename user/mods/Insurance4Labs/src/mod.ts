import { DependencyContainer } from "tsyringe";

import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { WeightedRandomHelper } from "@spt/helpers/WeightedRandomHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { Item } from "@spt/models/eft/common/tables/IItem";
import { IGetInsuranceCostRequestData } from "@spt/models/eft/insurance/IGetInsuranceCostRequestData";
import { IGetInsuranceCostResponseData } from "@spt/models/eft/insurance/IGetInsuranceCostResponseData";
import { IInsureRequestData } from "@spt/models/eft/insurance/IInsureRequestData";
import { IItemEventRouterResponse } from "@spt/models/eft/itemEvent/IItemEventRouterResponse";
import { Insurance } from "@spt/models/eft/profile/ISptProfile";
import { IProcessBuyTradeRequestData } from "@spt/models/eft/trade/IProcessBuyTradeRequestData";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { Money } from "@spt/models/enums/Money";
import { SkillTypes } from "@spt/models/enums/SkillTypes";
import { IInsuranceConfig } from "@spt/models/spt/config/IInsuranceConfig";
import { EventOutputHolder } from "@spt/routers/EventOutputHolder";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { InsuranceService } from "@spt/services/InsuranceService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { PaymentService } from "@spt/services/PaymentService";
import { RagfairPriceService } from "@spt/services/RagfairPriceService";
import { HashUtil } from "@spt/utils/HashUtil";
import { MathUtil } from "@spt/utils/MathUtil";
import { ProbabilityObject, ProbabilityObjectArray, RandomUtil } from "@spt/utils/RandomUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { ICloner } from "@spt/utils/cloners/ICloner";

import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { LauncherController } from "@spt/controllers/LauncherController";
import { InsuranceController } from "@spt/controllers/InsuranceController";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { ILoginRequestData } from "@spt/models/eft/launcher/ILoginRequestData";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { SaveServer } from "@spt/servers/SaveServer";

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

    // our new replacement function, ready to be used
    public replacementFunction(info: ILoginRequestData): string
    {
        // The original method requires the save server to be loaded
        const saveServer = Mod.container.resolve<SaveServer>("SaveServer");

        // The logic below is the original login method logic
        let originalReturn = "";
        for (const sessionID in saveServer.getProfiles())
        {
            const account = saveServer.getProfile(sessionID).info;
            if (info.username === account.username)
            {
                originalReturn = sessionID;
                break;
            }
        }

        // This is now extra stuff we want to add
        // We resolve 2 more dependencies: The logger and the DatabaseServer
        const logger = Mod.container.resolve<ILogger>("WinstonLogger");
        const dbServer = Mod.container.resolve<DatabaseServer>("DatabaseServer");

        // As an example Im counting the amount of loaded items on the DB
        const loadedItems = Object.entries(dbServer.getTables().templates.items).length;
        // Lets do a few informational messages
        logger.success(`User ${info.username} logged in to SPT, there are ${loadedItems} items loaded into the database`);
        logger.success(originalReturn.length > 0 ? `User session ID: ${originalReturn}` : "User not found");

        // And finally return whatever we were supposed to return through this function
        return originalReturn;
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
