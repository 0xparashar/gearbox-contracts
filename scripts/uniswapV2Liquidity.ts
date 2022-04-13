// @ts-ignore
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { 
  ICreditFilter, 
  ICreditFilter__factory, 
  ICreditManager__factory, 
  UniswapV2Adapter, 
  IUniswapV2Factory__factory, 
  IERC20__factory, 
  IERC20,
  IPriceOracle__factory,
  IPriceOracle,
  UniswapV2PriceFeed
} from "../types/ethers-v5";
import { tokenDataByNetwork, WAD, WETHToken } from "@diesellabs/gearbox-sdk";
import { BigNumber, BigNumberish } from "ethers";

const multisig = "0xA7D5DDc1b8557914F158076b228AA91eF613f1D5";

async function refillToken(token: IERC20, receipent: string) {

  let daiWhale = "0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0";

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [daiWhale],
  });

  let signer = (await ethers.provider.getSigner(
    daiWhale
  )) as unknown as SignerWithAddress;

  const refillAmount = BigNumber.from(ethers.utils.parseEther("1000000"));
  const receipt = await token.connect(signer).transfer(receipent, refillAmount);
 
  await receipt.wait() 
}

async function assignPriceFeed(oracle: IPriceOracle, uniswapPriceFeed : UniswapV2PriceFeed, lp: string) {

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [multisig],
  });

  let signer = (await ethers.provider.getSigner(
    multisig
  )) as unknown as SignerWithAddress;

  const receipt = await oracle.connect(signer).addPriceFeed(lp, uniswapPriceFeed.address);
 
  await receipt.wait()    

}

async function whitelistToken(token: string, creditFilter: ICreditFilter) {

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [multisig],
  });

  let signer = (await ethers.provider.getSigner(
    multisig
  )) as unknown as SignerWithAddress;

  
  const receipt = await creditFilter.connect(signer).allowToken(token, 7750); // ltv of 77.5%
 
  await receipt.wait()  
}

async function whitelistAdapterAndRouter(creditFilter: ICreditFilter, router: string, adapter: string) {

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [multisig],
  });

  let signer = (await ethers.provider.getSigner(
    multisig
  )) as unknown as SignerWithAddress;

  const receipt = await creditFilter.connect(signer).allowContract(router, adapter);
  await receipt.wait();

}


async function deploy() {
  const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
  const deployer = accounts[0];
  const frnd = accounts[1];

  console.log(deployer.address)

  // DAI - ZRX

  const daiEthChainlink = "0x773616E4d11A78F511299002da57A0a94577F1f4";
  const ethChainlink = "0x0000000000000000000000000000000000000000";

  const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const factoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; 
  const factory = await IUniswapV2Factory__factory.connect(factoryAddress, deployer);

  const creditManagerAddress = "0x777E23A2AcB2fCbB35f6ccF98272d03C722Ba6EB";
  const priceOracleAddress = "0x0e74a08443c5E39108520589176Ac12EF65AB080";
  const dai = IERC20__factory.connect(tokenDataByNetwork.Mainnet.DAI.address, deployer); //WETHToken.Mainnet
  const weth = IERC20__factory.connect(tokenDataByNetwork.Mainnet.WETH.address, deployer);


  const creditManager = ICreditManager__factory.connect(creditManagerAddress, deployer)

  const creditFilterAddress = await creditManager.creditFilter();
  const creditFilter = ICreditFilter__factory.connect(creditFilterAddress, deployer);

  const priceOracle = IPriceOracle__factory.connect(priceOracleAddress, deployer);

  let signer = deployer;

  await refillToken(dai, signer.address);

  const initialFund = BigNumber.from(ethers.utils.parseEther("10000")); // Initial funds to open credit account 10k DAI

  let receipt = await dai.approve(creditManager.address, initialFund);
  await receipt.wait();

  receipt = await creditManager.openCreditAccount(initialFund, signer.address, 300, 0);
  await receipt.wait();
  console.log("Credit Account Opened");
  let UniswapAdapter = await ethers.getContractFactory("UniswapV2Adapter");
  let adapter = (await UniswapAdapter.deploy(creditManager.address, routerAddress)) as UniswapV2Adapter;
  console.log("Adapter Deployed");
  receipt = await signer.sendTransaction({value: ethers.utils.parseEther("2"), to: multisig});
  await receipt.wait();

  await whitelistAdapterAndRouter(creditFilter, routerAddress, adapter.address);
  console.log("Adapter and Router set");
  let lpToken = await factory.getPair(dai.address, weth.address);

  const addressProvider = "0xcf64698aff7e5f27a11dff868af228653ba53be0";

  let UniswapV2PriceFeedFactory = await ethers.getContractFactory("UniswapV2PriceFeed");
  let uniswapPriceFeed = (await UniswapV2PriceFeedFactory.deploy(addressProvider, lpToken, daiEthChainlink, ethChainlink)) as UniswapV2PriceFeed;

  console.log("Price Feed deployed");

  await assignPriceFeed(priceOracle, uniswapPriceFeed, lpToken);
  console.log("Price feed assigned");

  await whitelistToken(lpToken, creditFilter);
  console.log("Lp Token whitelisted");
  // total borrowed is 3*10k = 30k

  let creditAccount = await creditManager.creditAccounts(signer.address);
  let preSwapValue = await creditFilter.calcTotalValue(creditAccount);
  console.log("Initial value is ", preSwapValue.toString());

  // swap 10k dai for eth
  let amountIn = BigNumber.from(ethers.utils.parseEther("10000"));
  receipt = await adapter.swapExactTokensForTokens(amountIn, 0, [dai.address, weth.address], frnd.address, Date.now());

  await receipt.wait();

  // add liquidity of 10k DAI and eth got from selling 10k DAI

  let postSwapValue = await creditFilter.calcTotalValue(creditAccount);
  console.log("Post swap value is ", postSwapValue.toString());

  let wethIn = await weth.balanceOf(creditAccount);

  receipt = await adapter.addLiquidity(dai.address, weth.address, amountIn, wethIn, 0, 0, frnd.address, Date.now()); 

  await receipt.wait();

  let postAddLiquidityValue = await creditFilter.calcTotalValue(creditAccount);
  console.log("Post Add liquidity Value is ", postAddLiquidityValue.toString());

  const lp = IERC20__factory.connect(lpToken, deployer);
  let lpBalance = await lp.balanceOf(creditAccount);

  receipt = await adapter.removeLiquidity(dai.address, weth.address, lpBalance, 0, 0, frnd.address, Date.now()); 
  await receipt.wait();

  let postRemoveLiquidityValue = await creditFilter.calcTotalValue(creditAccount);
  console.log("Post Remove liquidity Value is ", postRemoveLiquidityValue.toString());

}

deploy()
  .then(() => console.log("Ok"))
  .catch((e) => console.log(e));