// SPDX-License-Identifier: BUSL-1.1
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IUniswapV2Pair} from "../integrations/uniswap/IUniswapV2Pair.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {ACLTrait} from "../core/ACLTrait.sol";
import {AddressProvider} from "../core/AddressProvider.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";



/// @title Uniswap V2 LP Chainlink pricefeed adapter
contract UniswapV2PriceFeed is AggregatorV3Interface, ACLTrait {
    using SafeMath for uint256;
    AggregatorV3Interface public priceFeed0; // Address of chainlink price feed token0 => Eth
    AggregatorV3Interface public priceFeed1; // Address of chainlink price feed token1 => Eth
    uint256 public dec0;
    uint256 public dec1;
    IUniswapV2Pair public pair;

    address public token0;
    address public token1;
    address public wethAddress;

    uint256 WAD = 10**18;

    constructor(
        address addressProvider,
        address _pair,
        address _priceFeed0,
        address _priceFeed1
    ) ACLTrait(addressProvider) {
        require(
            _pair != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        wethAddress = AddressProvider(addressProvider).getWethToken();
        pair = IUniswapV2Pair(_pair);
        dec0 = uint256(ERC20(pair.token0()).decimals());
        dec1 = uint256(ERC20(pair.token1()).decimals());
        token0 = pair.token0();
        token1 = pair.token1();
        require(
            (token0 == wethAddress || _priceFeed0 != address(0))
                && (token1 == wethAddress || _priceFeed1 != address(0))
            , Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        priceFeed0 = AggregatorV3Interface(_priceFeed0);
        priceFeed1 = AggregatorV3Interface(_priceFeed1);
    }

    function decimals() external view override returns (uint8) {
        return pair.decimals();
    }

    function description() external view override returns (string memory) {
        return priceFeed0.description();
    }

    function version() external view override returns (uint256) {
        return priceFeed0.version();
    }

    function getRoundData(uint80)
        external
        pure
        override
        returns (
            uint80, // roundId,
            int256, // answer,
            uint256, // startedAt,
            uint256, // updatedAt,
            uint80 // answeredInRound
        )
    {
        revert("Function is not supported");
    }

    function _sqrt(uint _x) internal pure returns(uint y) {
        uint z = (_x + 1) / 2;
        y = _x;
        while (z < y) {
            y = z;
            z = (_x / z + z) / 2;
        }
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        int256 answer0;
        int256 answer1; 
        



        if(token0 == wethAddress){
            answer0 = int256(WAD);
        }else{
            (roundId, answer0, startedAt, updatedAt, answeredInRound) = priceFeed0.latestRoundData();
            answer0 = int256(uint256(answer0).mul(WAD).div(10**uint256(priceFeed0.decimals())));
        }

        
        if(token1 == wethAddress){
            answer1 = int256(WAD);
        }else{
            (,answer1,,,) = priceFeed1.latestRoundData();
            answer1 = int256(uint256(answer1).mul(WAD).div(10**uint256(priceFeed1.decimals())));
        }

        (uint112 r0, uint112 r1,) = pair.getReserves();

        uint256 supply = pair.totalSupply();

        uint256 value0 = uint256(answer0).mul(uint256(r0)).div(10**dec0);
        uint256 value1 = uint256(answer1).mul(uint256(r1)).div(10**dec1);
        uint256 sqrt = _sqrt(value0.mul(value1));
        answer = int256((2 * WAD).mul(sqrt).div(supply));
    }

}
